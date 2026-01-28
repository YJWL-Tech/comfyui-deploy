import { Queue, QueueOptions } from "bullmq";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
});

export const workflowRunQueue = new Queue("workflow-run-queue", {
    connection: redis,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 5000,
        },
        removeOnComplete: {
            age: 3600, // 保留1小时
            count: 1000,
        },
        removeOnFail: {
            age: 86400, // 保留24小时
        },
    },
});

export interface QueueJobData {
    deployment_id: string;
    inputs?: Record<string, string | number>;
    origin: string;
    apiUser?: {
        user_id: string;
        org_id?: string;
    };
    retryCount?: number; // 重试次数，用于设置优先级
}

export async function addJobToQueue(data: QueueJobData) {
    // 使用递增计数作为优先级，保证 FIFO 顺序
    // BullMQ 优先级：数字越小优先级越高，范围 0-2097152
    // 使用 timestamp 的秒级部分 % 2097152，约 24 天的循环
    const timestamp = Date.now();
    const priority = Math.floor(timestamp / 1000) % 2097152; // 秒级，约 24 天循环
    
    const job = await workflowRunQueue.add("run-workflow", data, {
        jobId: `workflow-${timestamp}-${Math.random().toString(36).substring(2, 9)}`,
        priority: priority, // 早提交的任务 priority 更小，优先级更高
    });

    // 【事件驱动调度】任务加入队列后，尝试立即执行（如果有空闲 machine）
    if (process.env.USE_EVENT_DRIVEN_SCHEDULER === "true") {
        try {
            const { tryProcessNextJob } = await import("./event-driven-scheduler");
            // 异步处理，不阻塞当前请求
            tryProcessNextJob().catch(err => {
                console.error(`[Scheduler] Error processing job after enqueue:`, err);
            });
        } catch (err) {
            // 忽略错误，不影响主流程
        }
    }

    return job;
}

export async function getQueueStatus() {
    const waiting = await workflowRunQueue.getWaitingCount();
    const prioritized = await workflowRunQueue.getPrioritizedCount();
    const active = await workflowRunQueue.getActiveCount();
    const completed = await workflowRunQueue.getCompletedCount();
    const failed = await workflowRunQueue.getFailedCount();
    const delayed = await workflowRunQueue.getDelayedCount();

    // 将 waiting 和 prioritized 合并，因为它们都是等待执行的任务
    return {
        waiting: waiting + prioritized,
        active,
        completed,
        failed,
        delayed,
    };
}

/**
 * 通过 job_id 获取任务状态
 * 如果 job 已被删除，会通过 workflow_runs 表中的 queue_job_id 查询
 */
export async function getJobStatus(jobId: string) {
    try {
        const job = await workflowRunQueue.getJob(jobId);

        // 如果 job 还在队列中（waiting/active/completed/failed）
        if (job) {
            const state = await job.getState();
            const progress = job.progress;
            const returnvalue = job.returnvalue;
            const failedReason = job.failedReason;

            // 如果任务已完成，尝试从 returnvalue 中获取 workflow_run_id
            let workflow_run_id: string | undefined;
            if (returnvalue && typeof returnvalue === "object" && "workflow_run_id" in returnvalue) {
                workflow_run_id = returnvalue.workflow_run_id as string;
            }

            return {
                job_id: jobId,
                queue_status: state, // 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
                progress,
                workflow_run_id,
                failed_reason: failedReason,
                created_at: new Date(job.timestamp).toISOString(),
                processed_on: job.processedOn ? new Date(job.processedOn).toISOString() : null,
                finished_on: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
            };
        }

        // 如果 job 不在队列中（可能已被删除），通过 workflow_runs 表查询
        const { db } = await import("@/db/db");
        const { workflowRunsTable } = await import("@/db/schema");
        const { eq } = await import("drizzle-orm");

        const workflowRun = await db.query.workflowRunsTable.findFirst({
            where: eq(workflowRunsTable.queue_job_id, jobId),
            with: {
                workflow: {
                    columns: {
                        org_id: true,
                        user_id: true,
                    },
                },
            },
        });

        if (workflowRun) {
            return {
                job_id: jobId,
                queue_status: "completed", // job 已完成并从队列中删除
                workflow_run_id: workflowRun.id,
                workflow_status: workflowRun.status,
                created_at: workflowRun.created_at.toISOString(),
                started_at: workflowRun.started_at?.toISOString() || null,
                ended_at: workflowRun.ended_at?.toISOString() || null,
            };
        }

        // 既不在队列中，也不在数据库中
        return {
            job_id: jobId,
            queue_status: "not-found",
            message: "Job not found in queue or database",
        };
    } catch (error) {
        console.error(`Error getting job status for ${jobId}:`, error);
        return {
            job_id: jobId,
            queue_status: "error",
            message: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

/**
 * 获取队列中的所有任务（按状态分类）
 */
export async function getQueueJobs() {
    try {
        const [waiting, prioritized, active, completed, failed, delayed] = await Promise.all([
            workflowRunQueue.getWaiting(0, 100),
            workflowRunQueue.getPrioritized(0, 100),
            workflowRunQueue.getActive(0, 100),
            workflowRunQueue.getCompleted(0, 100),
            workflowRunQueue.getFailed(0, 100),
            workflowRunQueue.getDelayed(0, 100),
        ]);

        // 合并 waiting 和 prioritized 任务
        const allWaiting = [...waiting, ...prioritized];

        const formatJob = async (job: any) => {
            const state = await job.getState();
            let workflow_id: string | undefined = undefined;

            // 如果任务已完成且有 workflow_run_id，查询数据库获取 workflow_id
            if (state === "completed" && job.returnvalue?.workflow_run_id) {
                try {
                    const { db } = await import("@/db/db");
                    const { workflowRunsTable } = await import("@/db/schema");
                    const { eq } = await import("drizzle-orm");

                    const workflowRun = await db.query.workflowRunsTable.findFirst({
                        where: eq(workflowRunsTable.id, job.returnvalue.workflow_run_id),
                        columns: {
                            workflow_id: true,
                        },
                    });

                    if (workflowRun) {
                        workflow_id = workflowRun.workflow_id;
                    }
                } catch (error) {
                    console.error(`Error getting workflow_id for run ${job.returnvalue.workflow_run_id}:`, error);
                }
            }

            // 获取 delayed job 的预计执行时间
            let delayedUntil: string | null = null;
            if (state === "delayed" && job.delay) {
                // job.delay 是延迟的毫秒数，job.timestamp 是创建时间
                // 对于 moveToDelayed，实际执行时间存储在 job 的内部属性中
                try {
                    const delayUntilTimestamp = await job.getDelayUntil?.() || (job.timestamp + (job.delay || 0));
                    if (delayUntilTimestamp) {
                        delayedUntil = new Date(delayUntilTimestamp).toISOString();
                    }
                } catch (e) {
                    // 忽略错误
                }
            }

            return {
                id: job.id,
                name: job.name,
                data: job.data,
                state,
                progress: job.progress,
                timestamp: new Date(job.timestamp).toISOString(),
                processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
                finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
                failedReason: job.failedReason,
                returnvalue: job.returnvalue,
                workflow_id, // 添加 workflow_id 字段
                delayedUntil, // 添加预计执行时间
                attemptsMade: job.attemptsMade, // 添加尝试次数
            };
        };

        return {
            waiting: await Promise.all(allWaiting.map(formatJob)),
            active: await Promise.all(active.map(formatJob)),
            completed: await Promise.all(completed.map(formatJob)),
            failed: await Promise.all(failed.map(formatJob)),
            delayed: await Promise.all(delayed.map(formatJob)),
        };
    } catch (error) {
        console.error("Error getting queue jobs:", error);
        throw error;
    }
}

/**
 * 取消单个任务
 */
export async function removeJob(jobId: string) {
    try {
        const job = await workflowRunQueue.getJob(jobId);
        if (!job) {
            throw new Error("Job not found");
        }

        const state = await job.getState();

        // 如果任务正在执行，需要先移除
        if (state === "active") {
            await job.remove();
        } else {
            await job.remove();
        }

        return { success: true, message: "Job removed successfully" };
    } catch (error) {
        console.error(`Error removing job ${jobId}:`, error);
        throw error;
    }
}

/**
 * 清空队列（移除所有等待中的任务）
 */
export async function cleanQueue(status: "waiting" | "active" | "completed" | "failed" | "delayed" = "waiting") {
    try {
        const cleanedJobs = await workflowRunQueue.clean(0, 1000, status);
        const cleaned = Array.isArray(cleanedJobs) ? cleanedJobs.length : cleanedJobs;

        return { success: true, cleaned, message: `Cleaned ${cleaned} jobs from ${status} queue` };
    } catch (error) {
        console.error(`Error cleaning queue (${status}):`, error);
        throw error;
    }
}

/**
 * 清空所有队列
 */
export async function cleanAllQueues() {
    try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
            workflowRunQueue.clean(0, 1000, "waiting"),
            workflowRunQueue.clean(0, 1000, "active"),
            workflowRunQueue.clean(0, 1000, "completed"),
            workflowRunQueue.clean(0, 1000, "failed"),
            workflowRunQueue.clean(0, 1000, "delayed"),
        ]);

        const getCount = (result: any) => Array.isArray(result) ? result.length : result;
        const waitingCount = getCount(waiting);
        const activeCount = getCount(active);
        const completedCount = getCount(completed);
        const failedCount = getCount(failed);
        const delayedCount = getCount(delayed);
        const total = waitingCount + activeCount + completedCount + failedCount + delayedCount;

        return {
            success: true,
            cleaned: total,
            details: {
                waiting: waitingCount,
                active: activeCount,
                completed: completedCount,
                failed: failedCount,
                delayed: delayedCount,
            },
            message: `Cleaned ${total} jobs from all queues`,
        };
    } catch (error) {
        console.error("Error cleaning all queues:", error);
        throw error;
    }
}

