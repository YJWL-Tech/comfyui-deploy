/**
 * 集成到 Next.js 的 Worker 实现
 * 
 * 注意：此实现主要用于开发环境或特定部署场景
 * 生产环境建议使用独立的 worker 进程
 */

import { Worker } from "bullmq";
import Redis from "ioredis";
import { processQueueJob } from "./queue-worker-core";

// 使用 global 对象存储实例，防止 Next.js 热重载时丢失实例引用
declare global {
    var _workerInstance: Worker | null | undefined;
    var _redisInstance: Redis | null | undefined;
}

// 获取或初始化实例的辅助函数
function getWorkerInstance(): Worker | null {
    return global._workerInstance || null;
}

function setWorkerInstance(worker: Worker | null) {
    global._workerInstance = worker;
}

function getRedisInstance(): Redis | null {
    return global._redisInstance || null;
}

function setRedisInstance(redis: Redis | null) {
    global._redisInstance = redis;
}

export function startWorker() {
    // 单例保护：如果已经启动，直接返回
    const existingWorker = getWorkerInstance();
    if (existingWorker) {
        console.log("⚠️  Worker already started, skipping...");
        console.log("   (Worker instance is stored in global to survive Next.js hot reloads)");
        return;
    }

    // 检查环境：Serverless 环境不支持
    if (process.env.VERCEL || process.env.NETLIFY) {
        console.log("⚠️  Skipping worker in serverless environment");
        return;
    }

    console.log("=".repeat(60));
    console.log("🚀 Starting Integrated Queue Worker...");
    console.log("=".repeat(60));
    console.log(`📅 Start Time: ${new Date().toISOString()}`);
    console.log(`🔧 Redis URL: ${process.env.REDIS_URL || "redis://localhost:6379"}`);
    console.log(`⚙️  Worker Concurrency: ${process.env.WORKER_CONCURRENCY || "5"}`);

    try {
        const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
            maxRetriesPerRequest: null,
        });
        setRedisInstance(redis);

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

        const loadBalancerStrategy =
            (process.env.LOAD_BALANCER_STRATEGY as "round-robin" | "least-load") ||
            "least-load";

        const worker = new Worker(
            "workflow-run-queue",
            async (job) => {
                console.log(`\n📦 [JOB ${job.id}] Processing job for deployment ${job.data.deployment_id}`);
                try {
                    // 使用共享的核心处理逻辑，但禁用详细日志（集成模式通常不需要太多日志）
                    return await processQueueJob({
                        job,
                        loadBalancerStrategy,
                        enableDetailedLogging: false, // 集成模式使用简单日志
                    });
                } catch (error: any) {
                    // 如果是因为 machine 不可用导致的错误，设置延迟重试
                    // 这样 worker 可以继续处理其他 machine 的任务
                    if (error?.needsDelayedRetry) {
                        // 增加重试计数
                        const retryCount = (job.data.retryCount || 0) + 1;
                        const maxRetries = parseInt(process.env.MAX_QUEUE_RETRIES || "50"); // 默认最多重试50次

                        if (retryCount > maxRetries) {
                            // 超过最大重试次数，标记为失败
                            console.error(`❌ [JOB ${job.id}] Machine "${error.machineName}" not available after ${maxRetries} retries`);
                            console.error(`   Marking job as failed to prevent infinite retries`);
                            throw new Error(`Machine "${error.machineName}" not available after ${maxRetries} retries`);
                        }

                        // 计算延迟时间：随着重试次数增加，延迟时间也增加（指数退避）
                        // 重试 1-5 次: 10 秒
                        // 重试 6-10 次: 20 秒
                        // 重试 11-20 次: 30 秒
                        // 重试 21+ 次: 60 秒
                        let delayMs = 10000; // 默认 10 秒
                        if (retryCount > 20) {
                            delayMs = 60000; // 1 分钟
                        } else if (retryCount > 10) {
                            delayMs = 30000; // 30 秒
                        } else if (retryCount > 5) {
                            delayMs = 20000; // 20 秒
                        }

                        console.log(`⏰ [JOB ${job.id}] Machine "${error.machineName}" not available, setting delayed retry #${retryCount}/${maxRetries} (${delayMs / 1000}s)`);
                        console.log(`   This job will have higher priority when retried (priority will be ${Math.max(1, 6 - retryCount)})`);
                        console.log(`   Worker will continue processing jobs for other machines`);

                        // 更新 job data 以记录重试次数
                        await job.updateData({
                            ...job.data,
                            retryCount: retryCount,
                        });

                        // 使用延迟时间（随重试次数增加）
                        await job.moveToDelayed(Date.now() + delayMs, job.token);

                        // 注意：job.moveToDelayed 不能直接修改优先级
                        // 但我们已经在 job.data 中记录了 retryCount
                        throw error;
                    }
                    throw error;
                }
            },
            {
                connection: redis,
                concurrency: parseInt(process.env.WORKER_CONCURRENCY || "5"),
            },
        );

        // Worker 就绪事件
        worker.on("ready", () => {
            console.log("=".repeat(60));
            console.log("✅ Integrated Queue Worker is ready and listening for jobs");
            console.log(`   Queue Name: workflow-run-queue`);
            console.log(`   Concurrency: ${parseInt(process.env.WORKER_CONCURRENCY || "5")}`);
            console.log(`   Load Balancer: ${loadBalancerStrategy}`);
            console.log(`   Ready at: ${new Date().toISOString()}`);
            console.log("=".repeat(60));
            console.log("📝 Worker is now processing jobs...\n");
        });

        worker.on("active", (job) => {
            console.log(`🔄 [JOB ${job.id}] Job is now active (being processed)`);
        });

        worker.on("completed", (job) => {
            if (job) {
                console.log(`\n✅ [JOB ${job.id}] Completed successfully`);
                if (job.returnvalue && typeof job.returnvalue === "object" && "workflow_run_id" in job.returnvalue) {
                    console.log(`   Workflow Run ID: ${job.returnvalue.workflow_run_id}`);
                }
            }
        });

        worker.on("failed", async (job, err) => {
            console.log("\n" + "=".repeat(60));
            if (job) {
                console.error(`❌ [JOB ${job.id}] Failed`);
                console.error(`   Error:`, err);
                console.error(`   Attempts: ${job.attemptsMade}`);
                if (job.failedReason) {
                    console.error(`   Reason: ${job.failedReason}`);
                }
                
                // 发送失败通知（即使没有 workflow_run 记录）
                try {
                    const webhookUrl = process.env.WEBHOOK_NOTIFICATION_URL;
                    if (webhookUrl) {
                        const { enqueueNotification } = await import("@/server/notifications/notification-queue");
                        const payload = {
                            workflow_run_id: `queue-job-${job.id}`, // 使用 job_id 作为标识
                            status: "failed" as const,
                            job_id: job.id,
                            deployment_id: job.data.deployment_id,
                            error: err.message || "Unknown error",
                            completed_at: new Date().toISOString(),
                            webhook_url: webhookUrl,
                            webhook_auth_header: process.env.WEBHOOK_AUTHORIZATION_HEADER,
                        };
                        await enqueueNotification(payload);
                        console.log(`✅ [JOB ${job.id}] Failure notification enqueued`);
                    }
                } catch (notifyError) {
                    console.error(`❌ [JOB ${job.id}] Failed to enqueue failure notification:`, notifyError);
                }
            } else {
                console.error("❌ Job failed (job info unavailable)");
                console.error(`   Error:`, err);
            }
            console.log("=".repeat(60) + "\n");
        });

        worker.on("error", (err) => {
            console.error("\n" + "=".repeat(60));
            console.error("❌ Worker error occurred");
            console.error(`   Time: ${new Date().toISOString()}`);
            console.error(`   Error:`, err);
            console.log("=".repeat(60) + "\n");
        });

        worker.on("stalled", (jobId) => {
            console.warn(`⚠️  [JOB ${jobId}] Job stalled (may be taking too long)`);
        });

        setWorkerInstance(worker);

        // 检查 Redis 连接
        redis.ping()
            .then(() => {
                console.log("✅ Redis ping successful");
            })
            .catch((err) => {
                console.error("❌ Redis ping failed:", err);
                console.error("   Please check if Redis is running and accessible");
            });

        // 优雅关闭
        const cleanup = async () => {
            console.log("\n🛑 Closing integrated worker...");
            const worker = getWorkerInstance();
            if (worker) {
                await worker.close();
                setWorkerInstance(null);
            }
            const redis = getRedisInstance();
            if (redis) {
                await redis.quit();
                setRedisInstance(null);
            }
            console.log("✅ Worker closed gracefully");
        };

        process.on("SIGTERM", cleanup);
        process.on("SIGINT", cleanup);

        console.log("⏳ Waiting for worker to be ready...");
    } catch (error) {
        console.error("❌ Failed to start integrated worker:", error);
        console.error("   Error details:", error instanceof Error ? error.stack : String(error));
    }
}

export async function stopWorker(force: boolean = false) {
    console.log("🛑 Stopping integrated worker...");
    if (force) {
        console.log("⚠️  Force stop enabled - active jobs will be interrupted");
    } else {
        console.log("ℹ️  Graceful stop - waiting for active jobs to complete");
    }

    const workerInstance = getWorkerInstance();
    const redisInstance = getRedisInstance();

    if (workerInstance) {
        try {
            // 检查当前队列状态（仅用于日志）
            if (redisInstance) {
                try {
                    const { Queue } = await import("bullmq");
                    const queue = new Queue("workflow-run-queue", {
                        connection: redisInstance,
                    });
                    const [waiting, active] = await Promise.all([
                        queue.getWaitingCount(),
                        queue.getActiveCount(),
                    ]);
                    console.log(`📊 Queue status before stop: waiting=${waiting}, active=${active}`);
                    console.log(`ℹ️  Note: Completed jobs do not affect worker stop, only active jobs do`);
                    await queue.close();
                } catch (err) {
                    // 忽略检查错误，继续停止
                    console.log("⚠️  Could not check queue status:", err);
                }
            }

            // BullMQ 的 close 方法
            // 注意：已完成（completed）的任务不会影响停止，只有 active 任务会影响
            // 使用 force=true 会立即停止，不等待 active 任务完成
            if (force) {
                // 强制停止：立即停止，不等待任务完成
                await workerInstance.close(true);
            } else {
                // 优雅停止：等待 active 任务完成
                await workerInstance.close();
            }
            console.log("✅ Worker closed");
            setWorkerInstance(null);
        } catch (error) {
            console.error("❌ Error closing worker:", error);
            // 即使出错也要清空实例
            setWorkerInstance(null);
        }
    } else {
        console.log("ℹ️  Worker is not running (no instance found)");
    }

    if (redisInstance) {
        try {
            await redisInstance.quit();
            console.log("✅ Redis connection closed");
            setRedisInstance(null);
        } catch (error) {
            console.error("❌ Error closing Redis:", error);
            setRedisInstance(null);
        }
    }

    console.log("✅ Worker stopped successfully");
}

