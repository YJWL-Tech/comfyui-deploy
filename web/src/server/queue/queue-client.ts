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
}

export async function addJobToQueue(data: QueueJobData) {
    return await workflowRunQueue.add("run-workflow", data, {
        jobId: `workflow-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    });
}

export async function getQueueStatus() {
    const waiting = await workflowRunQueue.getWaitingCount();
    const active = await workflowRunQueue.getActiveCount();
    const completed = await workflowRunQueue.getCompletedCount();
    const failed = await workflowRunQueue.getFailedCount();

    return {
        waiting,
        active,
        completed,
        failed,
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

