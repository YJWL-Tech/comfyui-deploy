/**
 * 集成到 Next.js 的 Worker 实现
 * 
 * 注意：此实现主要用于开发环境或特定部署场景
 * 生产环境建议使用独立的 worker 进程
 */

import { Worker } from "bullmq";
import Redis from "ioredis";
import { createRun } from "@/server/createRun";
import { db } from "@/db/db";
import { deploymentsTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { selectMachine } from "./machine-selector";
import {
    incrementMachineQueue,
    decrementMachineQueue,
} from "@/server/machine/updateMachineStatus";

let workerInstance: Worker | null = null;
let redisInstance: Redis | null = null;

export function startWorker() {
    // 单例保护：如果已经启动，直接返回
    if (workerInstance) {
        console.log("Worker already started, skipping...");
        return;
    }

    // 检查环境：Serverless 环境不支持
    if (process.env.VERCEL || process.env.NETLIFY) {
        console.log("Skipping worker in serverless environment");
        return;
    }

    try {
        const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
            maxRetriesPerRequest: null,
        });
        redisInstance = redis;

        const loadBalancerStrategy =
            (process.env.LOAD_BALANCER_STRATEGY as "round-robin" | "least-load") ||
            "least-load";

        const worker = new Worker(
            "workflow-run-queue",
            async (job) => {
                const { deployment_id, inputs, origin, apiUser } = job.data;

                console.log(`Processing job ${job.id} for deployment ${deployment_id}`);

                // 1. 获取deployment信息
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
                    throw new Error("Deployment not found");
                }

                // 2. 选择机器（支持机器组或单个机器）
                let selectedMachine;

                if (deployment.machine_group_id && deployment.machineGroup) {
                    // 从机器组中选择
                    const machines = deployment.machineGroup.members.map((m) => m.machine);
                    selectedMachine = await selectMachine(machines, loadBalancerStrategy);
                } else if (deployment.machine_id && deployment.machine) {
                    // 直接使用指定的机器
                    selectedMachine = deployment.machine;
                } else {
                    throw new Error("No machine or machine group specified");
                }

                if (!selectedMachine) {
                    throw new Error("No available machine found");
                }

                // 3. 检查机器是否可用
                if (
                    selectedMachine.disabled ||
                    (selectedMachine.operational_status === "busy" &&
                        selectedMachine.current_queue_size >=
                        selectedMachine.allow_comfyui_queue_size)
                ) {
                    // 如果不可用，延迟重试
                    throw new Error("Machine not available, will retry");
                }

                // 4. 更新机器状态（增加队列计数）
                await incrementMachineQueue(selectedMachine.id);

                try {
                    // 5. 执行任务（复用现有createRun函数）
                    const result = await createRun({
                        origin,
                        workflow_version_id: deployment.version,
                        machine_id: selectedMachine,
                        inputs,
                        runOrigin: "api",
                        apiUser,
                        queueJobId: job.id, // 传递 job_id 以便后续查询
                    });

                    if ("workflow_run_id" in result) {
                        console.log(`Job ${job.id} started successfully, workflow_run_id: ${result.workflow_run_id}`);
                    } else {
                        console.log(`Job ${job.id} started, but result format unexpected`);
                    }
                    return result;
                } catch (error) {
                    console.error(`Job ${job.id} failed to start:`, error);
                    // 如果启动失败，立即减少队列计数
                    await decrementMachineQueue(selectedMachine.id);
                    throw error;
                }
            },
            {
                connection: redis,
                concurrency: parseInt(process.env.WORKER_CONCURRENCY || "5"),
            },
        );

        worker.on("completed", (job) => {
            if (job) {
                console.log(`Job ${job.id} completed`);
            }
        });

        worker.on("failed", (job, err) => {
            if (job) {
                console.error(`Job ${job.id} failed:`, err);
            } else {
                console.error("Job failed (job info unavailable):", err);
            }
        });

        worker.on("error", (err) => {
            console.error("Worker error:", err);
        });

        workerInstance = worker;

        // 优雅关闭
        const cleanup = async () => {
            console.log("Closing worker...");
            if (workerInstance) {
                await workerInstance.close();
                workerInstance = null;
            }
            if (redisInstance) {
                await redisInstance.quit();
                redisInstance = null;
            }
        };

        process.on("SIGTERM", cleanup);
        process.on("SIGINT", cleanup);

        console.log("Queue worker started (integrated in Next.js)");
    } catch (error) {
        console.error("Failed to start worker:", error);
    }
}

export function stopWorker() {
    if (workerInstance) {
        workerInstance.close();
        workerInstance = null;
    }
    if (redisInstance) {
        redisInstance.quit();
        redisInstance = null;
    }
}

