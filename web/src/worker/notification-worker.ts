/**
 * 通知 Worker
 * 处理 webhook 通知任务，负责实际发送 HTTP 请求
 * 
 * 这个 worker 可以：
 * 1. 独立运行，不依赖主应用
 * 2. 自动重试失败的 webhook
 * 3. 即使 Strapi 重启，任务也会保留在队列中等待重试
 */

import { Worker } from "bullmq";
import Redis from "ioredis";
import type { NotificationPayload } from "@/server/notifications/notification-queue";

console.log("=".repeat(60));
console.log("🚀 Notification Worker Starting...");
console.log("=".repeat(60));
console.log(`📅 Start Time: ${new Date().toISOString()}`);
console.log(`🔧 Redis URL: ${process.env.REDIS_URL || "redis://localhost:6379"}`);

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
});

// Redis 连接事件
redis.on("connect", () => {
    console.log("✅ Redis connected successfully");
});

redis.on("error", (err) => {
    console.error("❌ Redis connection error:", err);
});

redis.on("ready", () => {
    console.log("✅ Redis ready");
});

const worker = new Worker(
    "notification-queue",
    async (job) => {
        const payload: NotificationPayload = job.data;

        console.log(`\n📤 [NOTIFICATION ${job.id}] Sending webhook notification`);
        console.log(`   Workflow Run ID: ${payload.workflow_run_id}`);
        console.log(`   Status: ${payload.status}`);
        console.log(`   Webhook URL: ${payload.webhook_url}`);
        console.log(`   Attempt: ${job.attemptsMade + 1}/${job.opts.attempts}`);

        try {
            const response = await fetch(payload.webhook_url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(payload.webhook_auth_header && {
                        "Authorization": `Bearer ${payload.webhook_auth_header}`
                    }),
                },
                body: JSON.stringify({
                    workflow_run_id: payload.workflow_run_id,
                    status: payload.status,
                    job_id: payload.job_id,
                    deployment_id: payload.deployment_id,
                    outputs: payload.outputs,
                    error: payload.error,
                    completed_at: payload.completed_at,
                }),
                // 设置超时
                signal: AbortSignal.timeout(30000), // 30 秒超时
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => "Unknown error");
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            console.log(`✅ [NOTIFICATION ${job.id}] Webhook sent successfully`);
            return { success: true, status: response.status };
        } catch (error: any) {
            console.error(`❌ [NOTIFICATION ${job.id}] Webhook failed:`, error.message);

            // 如果是网络错误或超时，抛出错误让 BullMQ 重试
            if (error.name === "AbortError" || error.name === "TypeError") {
                throw new Error(`Network error: ${error.message}`);
            }

            // 如果是 HTTP 错误，也重试（可能是临时错误）
            throw error;
        }
    },
    {
        connection: redis,
        concurrency: parseInt(process.env.NOTIFICATION_WORKER_CONCURRENCY || "10"),
    }
);

worker.on("completed", (job) => {
    console.log(`✅ [NOTIFICATION ${job.id}] Notification completed successfully`);
});

worker.on("failed", (job, err) => {
    if (job) {
        console.error(`❌ [NOTIFICATION ${job.id}] Notification failed after ${job.attemptsMade} attempts`);
        console.error(`   Error:`, err.message);
        console.error(`   Will retry: ${job.attemptsMade < (job.opts.attempts || 5)}`);
    } else {
        console.error(`❌ Notification failed (job info unavailable):`, err);
    }
});

worker.on("error", (err) => {
    console.error("❌ Notification worker error:", err);
});

// 优雅关闭
process.on("SIGTERM", async () => {
    console.log("SIGTERM received, closing notification worker...");
    await worker.close();
    await redis.quit();
    process.exit(0);
});

process.on("SIGINT", async () => {
    console.log("SIGINT received, closing notification worker...");
    await worker.close();
    await redis.quit();
    process.exit(0);
});

worker.on("ready", () => {
    console.log("=".repeat(60));
    console.log("✅ Notification Worker is ready and listening for jobs");
    console.log(`   Queue Name: notification-queue`);
    console.log(`   Concurrency: ${parseInt(process.env.NOTIFICATION_WORKER_CONCURRENCY || "10")}`);
    console.log(`   Ready at: ${new Date().toISOString()}`);
    console.log("=".repeat(60));
    console.log("📝 Worker is now processing notifications...\n");
});

// 检查 Redis 连接
redis.ping()
    .then(() => {
        console.log("✅ Redis ping successful");
    })
    .catch((err) => {
        console.error("❌ Redis ping failed:", err);
    });

console.log("⏳ Waiting for notification worker to be ready...");

