/**
 * 队列 Worker 核心处理逻辑
 * 被独立 worker 和集成 worker 共享
 */

import { Job } from "bullmq";
import { createRun } from "@/server/createRun";
import { db } from "@/db/db";
import { deploymentsTable, machinesTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { selectMachine } from "./machine-selector";
import {
    incrementMachineQueue,
    decrementMachineQueue,
} from "@/server/machine/updateMachineStatus";

export interface ProcessJobOptions {
    job: Job;
    loadBalancerStrategy: "round-robin" | "least-load";
    enableDetailedLogging?: boolean;
}

/**
 * 处理队列任务的核心逻辑
 */
export async function processQueueJob({
    job,
    loadBalancerStrategy,
    enableDetailedLogging = false,
}: ProcessJobOptions) {
    const startTime = Date.now();
    const { deployment_id, inputs, origin, apiUser } = job.data;

    // 统一日志函数
    const log = (message: string, ...args: any[]) => {
        if (enableDetailedLogging) {
            console.log(message, ...args);
        }
    };

    // 错误日志始终输出
    const logError = (message: string, ...args: any[]) => {
        console.error(message, ...args);
    };

    // 关键信息始终输出（无论日志级别）
    const logAlways = (message: string, ...args: any[]) => {
        console.log(message, ...args);
    };

    log("\n" + "=".repeat(60));
    log(`📦 [JOB ${job.id}] Starting processing`);
    log(`   Deployment ID: ${deployment_id}`);
    log(`   Origin: ${origin}`);
    log(`   Inputs: ${JSON.stringify(inputs || {})}`);
    log(`   Timestamp: ${new Date().toISOString()}`);

    // 1. 获取deployment信息
    log(`📋 [JOB ${job.id}] Step 1: Fetching deployment information...`);
    const deployment = await db.query.deploymentsTable.findFirst({
        where: eq(deploymentsTable.id, deployment_id),
        with: {
            version: true,
            machine: true,
            machineGroup: {
                with: {
                    members: {
                        with: {
                            machine: true,
                        },
                    },
                },
            },
        },
    });

    if (!deployment) {
        logError(`❌ [JOB ${job.id}] Deployment not found: ${deployment_id}`);
        throw new Error("Deployment not found");
    }
    log(`✅ [JOB ${job.id}] Deployment found: ${deployment_id}`);
    log(`   Environment: ${deployment.environment}`);
    log(`   Machine ID: ${deployment.machine_id || "N/A"}`);
    log(`   Machine Group ID: ${deployment.machine_group_id || "N/A"}`);

    // 2. 选择机器（支持机器组或单个机器）
    log(`🔍 [JOB ${job.id}] Step 2: Selecting machine...`);
    let selectedMachine;

    if (deployment.machine_group_id && deployment.machineGroup) {
        // 从机器组中选择
        log(`   Using machine group: ${deployment.machineGroup.name || deployment.machine_group_id}`);
        log(`   Group members count: ${deployment.machineGroup.members.length}`);
        const machines = deployment.machineGroup.members.map((m) => m.machine);
        log(`   Available machines: ${machines.map((m) => m.name).join(", ")}`);
        selectedMachine = await selectMachine(machines, loadBalancerStrategy);
        log(`   Selected machine from group: ${selectedMachine?.name || "N/A"} (${selectedMachine?.id || "N/A"})`);
    } else if (deployment.machine_id && deployment.machine) {
        // 直接使用指定的机器
        selectedMachine = deployment.machine;
        log(`   Using single machine: ${selectedMachine.name} (${selectedMachine.id})`);
    } else {
        logError(`❌ [JOB ${job.id}] No machine or machine group specified`);
        throw new Error("No machine or machine group specified");
    }

    if (!selectedMachine) {
        logError(`❌ [JOB ${job.id}] No available machine found`);
        throw new Error("No available machine found");
    }
    log(`✅ [JOB ${job.id}] Machine selected: ${selectedMachine.name}`);

    // 3. 检查机器基本可用性
    log(`🔍 [JOB ${job.id}] Step 3: Checking machine availability...`);
    log(`   Machine Status: ${selectedMachine.operational_status || "unknown"}`);
    log(`   Machine Disabled: ${selectedMachine.disabled}`);
    log(`   Current Queue Size: ${selectedMachine.current_queue_size || 0}`);
    log(`   Max Queue Size: ${selectedMachine.allow_comfyui_queue_size || 0}`);

    if (selectedMachine.disabled) {
        log(`⚠️  [JOB ${job.id}] Machine is disabled, will retry after delay`);
        const error = new Error("Machine is disabled, will retry") as any;
        error.machineId = selectedMachine.id;
        error.machineName = selectedMachine.name;
        error.needsDelayedRetry = true;
        throw error;
    }

    // 4. 原子性地增加队列计数（带队列限制检查）
    // 这个操作会在数据库层面原子性地检查队列是否已满并增加计数
    // 避免竞态条件：多个worker同时处理时不会超过队列限制
    log(`📈 [JOB ${job.id}] Step 4: Attempting to increment machine queue count (atomic operation)...`);
    const incremented = await incrementMachineQueue(
        selectedMachine.id,
        selectedMachine.allow_comfyui_queue_size || undefined
    );

    if (!incremented) {
        // 队列已满，重新查询当前状态用于日志
        const currentMachine = await db.query.machinesTable.findFirst({
            where: eq(machinesTable.id, selectedMachine.id),
            columns: {
                current_queue_size: true,
                allow_comfyui_queue_size: true,
            },
        });
        log(`⚠️  [JOB ${job.id}] Machine queue is full, will retry after delay`);
        log(`   Current Queue Size: ${currentMachine?.current_queue_size || 0}`);
        log(`   Max Queue Size: ${currentMachine?.allow_comfyui_queue_size || 0}`);
        log(`   This job will be delayed to allow worker to process other machines' jobs`);

        // 抛出特殊错误，带上 machine 信息，让调用方可以设置延迟重试
        const error = new Error("Machine queue is full, will retry") as any;
        error.machineId = selectedMachine.id;
        error.machineName = selectedMachine.name;
        error.needsDelayedRetry = true; // 标记需要延迟重试
        throw error;
    }
    log(`✅ [JOB ${job.id}] Machine queue count incremented (queue slot acquired)`);

    try {
        // 5. 执行任务（复用现有createRun函数）
        // 注意：createRun只是启动任务，不等待ComfyUI执行完成
        // ComfyUI会异步执行，并通过/api/update-run回调更新状态
        log(`🚀 [JOB ${job.id}] Step 5: Creating workflow run...`);
        log(`   Workflow Version ID: ${deployment.workflow_version_id}`);
        log(`   Machine: ${selectedMachine.name} (${selectedMachine.id})`);

        logAlways(`[JOB ${job.id}] Calling createRun function...`);
        // 从 worker 执行时，不传递 apiUser，让 createRun 跳过权限检查
        const result = await createRun({
            origin,
            workflow_version_id: deployment.version,
            machine_id: selectedMachine,
            inputs,
            runOrigin: "api",
            apiUser: undefined, // Worker 执行时不传递 apiUser，跳过权限检查
            queueJobId: job.id, // 传递 job_id 以便后续查询和跳过权限检查
        });

        logAlways(`[JOB ${job.id}] createRun returned:`, JSON.stringify(result, null, 2));

        // 检查是否有错误（withServerPromise 会在出错时返回 { error: string }）
        if (result && typeof result === "object" && "error" in result) {
            const errorMessage = (result as { error: string }).error;
            logError(`❌ [JOB ${job.id}] createRun returned an error: ${errorMessage}`);
            throw new Error(`createRun failed: ${errorMessage}`);
        }

        if ("workflow_run_id" in result) {
            const duration = Date.now() - startTime;
            // 关键信息始终输出
            logAlways(`✅ [JOB ${job.id}] Workflow run created successfully!`);
            logAlways(`   Workflow Run ID: ${result.workflow_run_id}`);
            logAlways(`   Duration: ${duration}ms`);
            logAlways(`   Database record created at: ${new Date().toISOString()}`);
            log(`   Note: Task is now running in ComfyUI, queue count will be decremented when status changes to success/failed`);
        } else {
            // 错误信息始终输出
            logError(`❌ [JOB ${job.id}] Workflow run started, but result format unexpected:`, result);
            logError(`   Result type: ${typeof result}`);
            logError(`   Result keys: ${result ? Object.keys(result).join(", ") : "null/undefined"}`);
            throw new Error(`createRun returned unexpected result format: ${JSON.stringify(result)}`);
        }
        // 任务已启动，但不等待完成
        // 队列计数会在/api/update-run中当状态变为success/failed时减少
        return result;
    } catch (error) {
        const duration = Date.now() - startTime;
        logError(`❌ [JOB ${job.id}] Failed to create workflow run after ${duration}ms:`, error);
        logError(`   Error details:`, error instanceof Error ? error.message : String(error));

        // 检查是否有 workflow_run 记录（createRun 可能在创建记录后失败）
        // 通过 queue_job_id 查找可能的 workflow_run 记录
        try {
            const { workflowRunsTable } = await import("@/db/schema");
            const existingRun = await db.query.workflowRunsTable.findFirst({
                where: eq(workflowRunsTable.queue_job_id, job.id!),
                columns: {
                    id: true,
                    status: true,
                },
            });

            if (existingRun && existingRun.status !== "failed") {
                log(`📝 [JOB ${job.id}] Found workflow_run record ${existingRun.id}, updating status to failed...`);
                const errorMessage = error instanceof Error ? error.message : String(error);

                // 更新状态为失败
                await db
                    .update(workflowRunsTable)
                    .set({
                        status: "failed",
                        ended_at: new Date(),
                    })
                    .where(eq(workflowRunsTable.id, existingRun.id));

                // 发送失败通知
                try {
                    const { sendWebhookNotification, buildWebhookPayload } = await import("@/server/notifications/webhook-notifier");
                    const payload = await buildWebhookPayload(
                        existingRun.id,
                        "failed",
                        errorMessage,
                    );
                    // 异步发送，不阻塞主流程
                    sendWebhookNotification(payload).catch(err => {
                        logError(`[JOB ${job.id}] Failed to send notification for run ${existingRun.id}:`, err);
                    });
                    log(`✅ [JOB ${job.id}] Notification sent for failed run ${existingRun.id}`);
                } catch (notificationError) {
                    logError(`[JOB ${job.id}] Error setting up notification for run ${existingRun.id}:`, notificationError);
                    // 不抛出错误，避免影响主流程
                }
            }
        } catch (dbError) {
            logError(`[JOB ${job.id}] Error checking for workflow_run record:`, dbError);
            // 不抛出错误，继续执行清理逻辑
        }

        // 如果启动失败，立即减少队列计数
        log(`📉 [JOB ${job.id}] Decrementing machine queue count due to failure...`);
        await decrementMachineQueue(selectedMachine.id);
        log(`✅ [JOB ${job.id}] Machine queue count decremented`);
        throw error;
    }
    // 注意：不在finally中减少队列计数，因为任务还在ComfyUI中执行
    // 队列计数会在/api/update-run中当状态变为success/failed时减少
}

