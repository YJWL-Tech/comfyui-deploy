/**
 * 通知队列服务
 * 使用 BullMQ 队列解耦 webhook 通知，避免因目标服务重启导致通知丢失
 */

import { Queue } from "bullmq";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
});

export const notificationQueue = new Queue("notification-queue", {
    connection: redis,
    defaultJobOptions: {
        attempts: 5, // 最多重试 5 次
        backoff: {
            type: "exponential",
            delay: 2000, // 初始延迟 2 秒
        },
        removeOnComplete: {
            age: 86400, // 保留 24 小时
            count: 1000,
        },
        removeOnFail: {
            age: 604800, // 失败任务保留 7 天
        },
    },
});

export interface NotificationPayload {
    workflow_run_id: string;
    status: "success" | "failed";
    job_id?: string;
    deployment_id?: string;
    outputs?: any;
    error?: string;
    completed_at: string;
    webhook_url: string;
    webhook_auth_header?: string;
}

/**
 * 将通知任务加入队列
 * 这样即使目标服务（如 Strapi）暂时不可用，任务也会保留在队列中
 */
export async function enqueueNotification(payload: NotificationPayload) {
    try {
        const job = await notificationQueue.add(
            "send-webhook",
            payload,
            {
                jobId: `notification-${payload.workflow_run_id}-${Date.now()}`,
                // 可以设置优先级，失败重试的任务优先级更高
                priority: 10,
            }
        );

        console.log(`[Notification Queue] Notification enqueued for run ${payload.workflow_run_id}, job ID: ${job.id}`);
        return job;
    } catch (error) {
        console.error("[Notification Queue] Failed to enqueue notification:", error);
        throw error;
    }
}

/**
 * 获取通知队列状态
 */
export async function getNotificationQueueStatus() {
    try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
            notificationQueue.getWaitingCount(),
            notificationQueue.getActiveCount(),
            notificationQueue.getCompletedCount(),
            notificationQueue.getFailedCount(),
            notificationQueue.getDelayedCount(),
        ]);

        return {
            waiting,
            active,
            completed,
            failed,
            delayed,
        };
    } catch (error) {
        console.error("[Notification Queue] Error getting queue status:", error);
        throw error;
    }
}

