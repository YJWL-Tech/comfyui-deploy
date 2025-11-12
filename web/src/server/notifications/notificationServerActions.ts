"use server";

import { auth } from "@clerk/nextjs";
import { getNotificationQueueStatus, notificationQueue } from "./notification-queue";
import { 
    startNotificationWorker, 
    stopNotificationWorker, 
    getNotificationWorkerStatus 
} from "@/worker/notification-worker-integrated";

/**
 * 获取通知队列状态
 */
export async function getNotificationQueueData() {
    const { userId } = auth();
    if (!userId) {
        throw new Error("Unauthorized");
    }

    try {
        const [status, jobs] = await Promise.all([
            getNotificationQueueStatus(),
            getNotificationQueueJobs(),
        ]);

        return {
            status,
            jobs,
        };
    } catch (error) {
        console.error("[getNotificationQueueData] Error:", error);
        throw error;
    }
}

/**
 * 获取通知队列中的所有任务
 */
async function getNotificationQueueJobs() {
    try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
            notificationQueue.getWaiting(0, 100),
            notificationQueue.getActive(0, 100),
            notificationQueue.getCompleted(0, 100),
            notificationQueue.getFailed(0, 100),
            notificationQueue.getDelayed(0, 100),
        ]);

        const formatJob = (job: any) => {
            const payload = job.data as any;
            return {
                id: job.id,
                name: job.name,
                workflow_run_id: payload.workflow_run_id,
                status: payload.status,
                webhook_url: payload.webhook_url,
                created_at: new Date(job.timestamp).toISOString(),
                processed_on: job.processedOn ? new Date(job.processedOn).toISOString() : null,
                finished_on: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
                attempts: job.attemptsMade,
                failed_reason: job.failedReason,
                returnvalue: job.returnvalue,
            };
        };

        return {
            waiting: waiting.map(formatJob),
            active: active.map(formatJob),
            completed: completed.map(formatJob),
            failed: failed.map(formatJob),
            delayed: delayed.map(formatJob),
        };
    } catch (error) {
        console.error("[getNotificationQueueJobs] Error:", error);
        throw error;
    }
}

/**
 * 启动通知 Worker
 */
export async function startNotificationWorkerAction() {
    const { userId } = auth();
    if (!userId) {
        throw new Error("Unauthorized");
    }

    try {
        const status = getNotificationWorkerStatus();
        if (status.isRunning) {
            return {
                success: false,
                message: "Notification Worker 已经在运行中",
            };
        }

        startNotificationWorker();
        
        // 等待一下让 worker 初始化
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const newStatus = getNotificationWorkerStatus();
        return {
            success: newStatus.isRunning,
            message: newStatus.isRunning 
                ? "Notification Worker 启动成功" 
                : "Notification Worker 启动失败，请检查日志",
        };
    } catch (error) {
        console.error("[startNotificationWorkerAction] Error:", error);
        return {
            success: false,
            message: error instanceof Error ? error.message : "启动 Notification Worker 失败",
        };
    }
}

/**
 * 停止通知 Worker
 */
export async function stopNotificationWorkerAction(force: boolean = true) {
    const { userId } = auth();
    if (!userId) {
        throw new Error("Unauthorized");
    }

    try {
        const status = getNotificationWorkerStatus();
        if (!status.isRunning) {
            return {
                success: true,
                message: "Notification Worker 未运行",
            };
        }

        await stopNotificationWorker(force);
        
        const newStatus = getNotificationWorkerStatus();
        return {
            success: !newStatus.isRunning,
            message: !newStatus.isRunning 
                ? `Notification Worker 已停止${force ? " (强制停止)" : ""}` 
                : "Notification Worker 停止失败",
        };
    } catch (error) {
        console.error("[stopNotificationWorkerAction] Error:", error);
        return {
            success: false,
            message: error instanceof Error ? error.message : "停止 Notification Worker 失败",
        };
    }
}

/**
 * 获取通知 Worker 状态
 */
export async function getNotificationWorkerStatusAction() {
    const { userId } = auth();
    if (!userId) {
        throw new Error("Unauthorized");
    }

    try {
        const status = getNotificationWorkerStatus();
        return {
            isRunning: status.isRunning,
            redisConnected: status.redisConnected,
            concurrency: process.env.NOTIFICATION_WORKER_CONCURRENCY || "10",
        };
    } catch (error) {
        console.error("[getNotificationWorkerStatusAction] Error:", error);
        return {
            isRunning: false,
            redisConnected: false,
            concurrency: "10",
        };
    }
}

/**
 * 清理通知队列
 */
export async function cleanNotificationQueue(status: "waiting" | "active" | "completed" | "failed" | "delayed" = "completed") {
    const { userId } = auth();
    if (!userId) {
        throw new Error("Unauthorized");
    }

    try {
        const cleanedJobs = await notificationQueue.clean(0, 1000, status);
        const cleaned = Array.isArray(cleanedJobs) ? cleanedJobs.length : cleanedJobs;

        return {
            success: true,
            cleaned,
            message: `已清理 ${cleaned} 个 ${status} 状态的通知任务`,
        };
    } catch (error) {
        console.error(`[cleanNotificationQueue] Error cleaning ${status}:`, error);
        return {
            success: false,
            cleaned: 0,
            message: error instanceof Error ? error.message : "清理失败",
        };
    }
}

