/**
 * 事件驱动调度器
 * 
 * 核心思路：不让 Worker 自动取任务，而是由 machine 空闲事件触发任务执行
 * 
 * 优点：
 * 1. 任务按 FIFO 顺序执行（最早的任务最先执行）
 * 2. 不会有"被延迟"的问题
 * 3. 新任务不会插队
 */

import { workflowRunQueue } from "./queue-client";
import { db } from "@/db/db";
import { machinesTable, deploymentsTable } from "@/db/schema";
import { eq, and, sql, lte } from "drizzle-orm";
import { createRun } from "@/server/createRun";
import { incrementMachineQueue } from "@/server/machine/updateMachineStatus";

/**
 * 当 machine 空闲时，尝试从队列中取下一个任务执行
 * 这个函数应该在以下情况调用：
 * 1. 任务完成（success/failed）时
 * 2. Worker 启动时（初始化）
 */
export async function tryProcessNextJob(machineId?: string) {
    console.log(`[Scheduler] Trying to process next job${machineId ? ` for machine ${machineId}` : ""}...`);

    try {
        // 1. 获取可用的 machine（有空闲队列位置）
        const availableMachines = await db.query.machinesTable.findMany({
            where: and(
                eq(machinesTable.disabled, false),
                eq(machinesTable.status, "ready"),
                // 队列未满
                sql`${machinesTable.current_queue_size} < ${machinesTable.allow_comfyui_queue_size}`
            ),
        });

        // 无可用机器时，拉取所有未禁用机器并打日志，便于排查“突然不可用”
        if (availableMachines.length === 0) {
            const allMachines = await db.query.machinesTable.findMany({
                where: eq(machinesTable.disabled, false),
                columns: {
                    id: true,
                    name: true,
                    status: true,
                    current_queue_size: true,
                    allow_comfyui_queue_size: true,
                    operational_status: true,
                },
            });
            console.log("[Scheduler] No available machines. Current machine states:");
            for (const m of allMachines) {
                const reason =
                    m.status !== "ready"
                        ? `status=${m.status}`
                        : m.current_queue_size >= (m.allow_comfyui_queue_size ?? 0)
                          ? `queue_full(${m.current_queue_size}/${m.allow_comfyui_queue_size})`
                          : "ok";
                console.log(
                    `   [Machine] ${m.name} (${m.id}): status=${m.status}, queue=${m.current_queue_size}/${m.allow_comfyui_queue_size}, op=${m.operational_status} => ${reason}`
                );
            }
            return { processed: false, reason: "no_available_machines" };
        }

        console.log(
            `[Scheduler] Found ${availableMachines.length} available machines: ${availableMachines.map((m) => `${m.name}(queue=${m.current_queue_size}/${m.allow_comfyui_queue_size})`).join(", ")}`
        );

        // 2. 从队列中获取等待中的任务（按优先级排序，最早的优先）
        // 注意：我们使用 getWaiting 而不是让 Worker 自动取
        const waitingJobs = await workflowRunQueue.getWaiting(0, 1);
        
        if (waitingJobs.length === 0) {
            // 也检查 prioritized 队列
            const prioritizedJobs = await workflowRunQueue.getPrioritized(0, 1);
            if (prioritizedJobs.length === 0) {
                console.log("[Scheduler] No waiting jobs in queue");
                return { processed: false, reason: "no_waiting_jobs" };
            }
        }

        const job = waitingJobs[0] || (await workflowRunQueue.getPrioritized(0, 1))[0];
        if (!job) {
            console.log("[Scheduler] No job to process");
            return { processed: false, reason: "no_job" };
        }

        console.log(`[Scheduler] Processing job ${job.id}...`);
        const { deployment_id, inputs, origin } = job.data;

        // 3. 获取 deployment 信息
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
            console.error(`[Scheduler] Deployment not found: ${deployment_id}`);
            await job.remove();
            return { processed: false, reason: "deployment_not_found" };
        }

        // 4. 选择 machine
        let selectedMachine;
        if (deployment.machine_group_id && deployment.machineGroup) {
            // 从机器组中选择一个可用的 machine
            const groupMachines = deployment.machineGroup.members.map(m => m.machine);
            selectedMachine = groupMachines.find(m => 
                !m.disabled && 
                m.status === "ready" && 
                m.current_queue_size < m.allow_comfyui_queue_size
            );
        } else if (deployment.machine_id && deployment.machine) {
            // 检查指定的 machine 是否可用
            const machine = deployment.machine;
            if (!machine.disabled && machine.status === "ready" && 
                machine.current_queue_size < machine.allow_comfyui_queue_size) {
                selectedMachine = machine;
            }
        }

        if (!selectedMachine) {
            const groupOrSingle = deployment.machine_group_id
                ? `group ${deployment.machineGroup?.name ?? deployment.machine_group_id}`
                : `machine ${deployment.machine?.name ?? deployment.machine_id}`;
            console.log(
                `[Scheduler] No suitable machine for job ${job.id} (${groupOrSingle}), will retry later. ` +
                    "If machines show queue_full, ComfyUI update-run callback may be failing (e.g. 403); try syncing queue from Machines page."
            );
            return { processed: false, reason: "no_suitable_machine" };
        }

        // 5. 原子性地增加队列计数
        const incremented = await incrementMachineQueue(
            selectedMachine.id,
            selectedMachine.allow_comfyui_queue_size || undefined
        );

        if (!incremented) {
            console.log(`[Scheduler] Machine ${selectedMachine.name} queue is full, will retry later`);
            return { processed: false, reason: "machine_queue_full" };
        }

        // 6. 执行任务
        console.log(`[Scheduler] Executing job ${job.id} on machine ${selectedMachine.name}...`);
        
        try {
            const result = await createRun({
                origin,
                workflow_version_id: deployment.version,
                machine_id: selectedMachine,
                inputs,
                runOrigin: "api",
                queueJobId: job.id,
            });

            if (result && "workflow_run_id" in result) {
                console.log(`[Scheduler] ✅ Job ${job.id} started, workflow_run_id: ${result.workflow_run_id}`);
                
                // 从队列中移除任务
                // 注意：任务详情已保存在 workflow_runs 表中
                // 可以在 Runs 页面查看已完成的任务，而不是 BullMQ 队列监控
                await job.remove();
                
                return { 
                    processed: true, 
                    job_id: job.id, 
                    workflow_run_id: result.workflow_run_id 
                };
            } else {
                throw new Error("createRun did not return workflow_run_id");
            }
        } catch (error) {
            console.error(`[Scheduler] ❌ Failed to execute job ${job.id}:`, error);
            // 执行失败，减少队列计数
            const { decrementMachineQueue } = await import("@/server/machine/updateMachineStatus");
            await decrementMachineQueue(selectedMachine.id);
            
            // 增加重试计数
            const retryCount = (job.data.retryCount || 0) + 1;
            const maxRetries = parseInt(process.env.SCHEDULER_MAX_RETRIES || "3");
            
            if (retryCount >= maxRetries) {
                // 超过最大重试次数，标记为失败并删除
                console.error(`[Scheduler] Job ${job.id} failed after ${retryCount} retries, marking as failed`);
                
                // 发送失败通知
                try {
                    const webhookUrl = process.env.WEBHOOK_NOTIFICATION_URL;
                    if (webhookUrl) {
                        const { enqueueNotification } = await import("@/server/notifications/notification-queue");
                        await enqueueNotification({
                            workflow_run_id: `scheduler-job-${job.id}`,
                            status: "failed" as const,
                            job_id: job.id,
                            deployment_id: job.data.deployment_id,
                            error: error instanceof Error ? error.message : String(error),
                            completed_at: new Date().toISOString(),
                            webhook_url: webhookUrl,
                            webhook_auth_header: process.env.WEBHOOK_AUTHORIZATION_HEADER,
                        });
                    }
                } catch (notifyError) {
                    console.error(`[Scheduler] Failed to send failure notification:`, notifyError);
                }
                
                await job.remove();
                return { processed: false, reason: "max_retries_exceeded", error };
            }
            
            // 更新重试计数，任务留在队列中等待下次调度
            await job.updateData({
                ...job.data,
                retryCount: retryCount,
            });
            console.log(`[Scheduler] Job ${job.id} will retry (${retryCount}/${maxRetries})`);
            
            return { processed: false, reason: "execution_failed", error };
        }

    } catch (error) {
        console.error("[Scheduler] Error in tryProcessNextJob:", error);
        return { processed: false, reason: "error", error };
    }
}

/**
 * 处理多个任务（填满所有可用的 machine）
 */
export async function processAllAvailableJobs() {
    console.log("[Scheduler] Processing all available jobs...");
    
    let processedCount = 0;
    let maxIterations = 100; // 防止无限循环
    
    while (maxIterations > 0) {
        const result = await tryProcessNextJob();
        if (!result.processed) {
            break;
        }
        processedCount++;
        maxIterations--;
    }
    
    console.log(`[Scheduler] Processed ${processedCount} jobs`);
    return { processedCount };
}

/**
 * 禁用 BullMQ Worker 的自动处理
 * 只使用事件驱动调度
 */
export function getSchedulerConfig() {
    return {
        // 建议配置
        workerConcurrency: 0, // 禁用 Worker 自动处理
        useEventDrivenScheduler: true,
    };
}
