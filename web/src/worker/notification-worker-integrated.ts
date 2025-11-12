/**
 * 集成到 Next.js 的 Notification Worker 实现
 * 与 queue-worker-integrated.ts 类似，但用于处理通知队列
 */

import { Worker } from "bullmq";
import Redis from "ioredis";
import type { NotificationPayload } from "@/server/notifications/notification-queue";

// 使用 global 对象存储实例，防止 Next.js 热重载时丢失实例引用
declare global {
    var _notificationWorkerInstance: Worker | null | undefined;
    var _notificationRedisInstance: Redis | null | undefined;
}

// 获取或初始化实例的辅助函数
function getNotificationWorkerInstance(): Worker | null {
    return global._notificationWorkerInstance || null;
}

function setNotificationWorkerInstance(worker: Worker | null) {
    global._notificationWorkerInstance = worker;
}

function getNotificationRedisInstance(): Redis | null {
    return global._notificationRedisInstance || null;
}

function setNotificationRedisInstance(redis: Redis | null) {
    global._notificationRedisInstance = redis;
}

export function startNotificationWorker() {
    // 单例保护：如果已经启动，直接返回
    const existingWorker = getNotificationWorkerInstance();
    if (existingWorker) {
        console.log("⚠️  Notification Worker already started, skipping...");
        return;
    }

    // 检查环境：Serverless 环境不支持
    if (process.env.VERCEL || process.env.NETLIFY) {
        console.log("⚠️  Skipping notification worker in serverless environment");
        return;
    }

    console.log("=".repeat(60));
    console.log("🚀 Starting Integrated Notification Worker...");
    console.log("=".repeat(60));
    console.log(`📅 Start Time: ${new Date().toISOString()}`);
    console.log(`🔧 Redis URL: ${process.env.REDIS_URL || "redis://localhost:6379"}`);
    console.log(`⚙️  Worker Concurrency: ${process.env.NOTIFICATION_WORKER_CONCURRENCY || "10"}`);

    try {
        const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
            maxRetriesPerRequest: null,
        });
        setNotificationRedisInstance(redis);

        // Redis 连接事件
        redis.on("connect", () => {
            console.log("✅ Notification Worker Redis connected successfully");
        });

        redis.on("error", (err) => {
            console.error("❌ Notification Worker Redis connection error:", err);
        });

        redis.on("ready", () => {
            console.log("✅ Notification Worker Redis ready");
        });

        const worker = new Worker(
            "notification-queue",
            async (job) => {
                const payload: NotificationPayload = job.data;

                console.log(`\n${"=".repeat(60)}`);
                console.log(`📤 [NOTIFICATION ${job.id}] Sending webhook notification`);
                console.log(`   Workflow Run ID: ${payload.workflow_run_id}`);
                console.log(`   Status: ${payload.status}`);
                console.log(`   Webhook URL: ${payload.webhook_url}`);
                console.log(`   Attempt: ${job.attemptsMade + 1}/${job.opts.attempts}`);
                console.log(`   Time: ${new Date().toISOString()}`);
                console.log(`${"=".repeat(60)}\n`);

                try {
                    console.log(`[NOTIFICATION ${job.id}] Making HTTP POST request to: ${payload.webhook_url}`);

                    const requestBody = {
                        workflow_run_id: payload.workflow_run_id,
                        status: payload.status,
                        job_id: payload.job_id,
                        deployment_id: payload.deployment_id,
                        outputs: payload.outputs,
                        error: payload.error,
                        completed_at: payload.completed_at,
                    };

                    console.log(`[NOTIFICATION ${job.id}] Request body:`, JSON.stringify(requestBody, null, 2));

                    const response = await fetch(payload.webhook_url, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            ...(payload.webhook_auth_header && {
                                "Authorization": `Bearer ${payload.webhook_auth_header}`
                            }),
                        },
                        body: JSON.stringify(requestBody),
                        signal: AbortSignal.timeout(30000), // 30 秒超时
                    });

                    console.log(`[NOTIFICATION ${job.id}] Response status: ${response.status} ${response.statusText}`);

                    if (!response.ok) {
                        const errorText = await response.text().catch(() => "Unknown error");
                        console.error(`[NOTIFICATION ${job.id}] Response error:`, errorText);
                        throw new Error(`HTTP ${response.status}: ${errorText}`);
                    }

                    const responseBody = await response.text().catch(() => "");
                    console.log(`[NOTIFICATION ${job.id}] Response body:`, responseBody);
                    console.log(`✅ [NOTIFICATION ${job.id}] Webhook sent successfully`);
                    return { success: true, status: response.status };
                } catch (error: any) {
                    console.error(`❌ [NOTIFICATION ${job.id}] Webhook failed:`, error.message);
                    console.error(`[NOTIFICATION ${job.id}] Error stack:`, error.stack);

                    if (error.name === "AbortError" || error.name === "TypeError") {
                        throw new Error(`Network error: ${error.message}`);
                    }

                    throw error;
                }
            },
            {
                connection: redis,
                concurrency: parseInt(process.env.NOTIFICATION_WORKER_CONCURRENCY || "10"),
            }
        );

        setNotificationWorkerInstance(worker);

        worker.on("completed", (job) => {
            console.log(`✅ [NOTIFICATION ${job.id}] Notification completed successfully`);
        });

        worker.on("failed", (job, err) => {
            if (job) {
                console.error(`❌ [NOTIFICATION ${job.id}] Notification failed after ${job.attemptsMade} attempts`);
                console.error(`   Error:`, err.message);
            } else {
                console.error(`❌ Notification failed (job info unavailable):`, err);
            }
        });

        worker.on("error", (err) => {
            console.error("❌ Notification worker error:", err);
        });

        worker.on("ready", () => {
            console.log("=".repeat(60));
            console.log("✅ Notification Worker is ready and listening for jobs");
            console.log(`   Queue Name: notification-queue`);
            console.log(`   Concurrency: ${parseInt(process.env.NOTIFICATION_WORKER_CONCURRENCY || "10")}`);
            console.log(`   Ready at: ${new Date().toISOString()}`);
            console.log("=".repeat(60));
        });

        console.log("✅ Notification Worker started successfully");
    } catch (error) {
        console.error("❌ Failed to start notification worker:", error);
        console.error("   Error details:", error instanceof Error ? error.stack : String(error));
    }
}

export async function stopNotificationWorker(force: boolean = false) {
    console.log("🛑 Stopping integrated notification worker...");
    if (force) {
        console.log("⚠️  Force stop enabled - active notifications will be interrupted");
    } else {
        console.log("ℹ️  Graceful stop - waiting for active notifications to complete");
    }

    const workerInstance = getNotificationWorkerInstance();
    const redisInstance = getNotificationRedisInstance();

    if (workerInstance) {
        try {
            if (force) {
                await workerInstance.close(true);
            } else {
                await workerInstance.close();
            }
            console.log("✅ Notification Worker closed");
            setNotificationWorkerInstance(null);
        } catch (error) {
            console.error("❌ Error closing notification worker:", error);
            throw error;
        }
    } else {
        console.log("ℹ️  Notification Worker was not running");
    }

    if (redisInstance) {
        try {
            await redisInstance.quit();
            console.log("✅ Notification Worker Redis connection closed");
            setNotificationRedisInstance(null);
        } catch (error) {
            console.error("❌ Error closing notification worker Redis:", error);
        }
    }

    console.log("✅ Notification Worker stopped successfully");
}

export function getNotificationWorkerStatus() {
    const workerInstance = getNotificationWorkerInstance();
    const redisInstance = getNotificationRedisInstance();

    return {
        isRunning: workerInstance !== null,
        redisConnected: redisInstance?.status === "ready",
    };
}

