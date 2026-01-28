import { Worker } from "bullmq";
import Redis from "ioredis";
import { processQueueJob } from "./queue-worker-core";

// 启动日志
console.log("=".repeat(60));
console.log("🚀 Queue Worker Starting...");
console.log("=".repeat(60));
console.log(`📅 Start Time: ${new Date().toISOString()}`);
console.log(`🔧 Redis URL: ${process.env.REDIS_URL || "redis://localhost:6379"}`);
console.log(`⚙️  Worker Concurrency: ${process.env.WORKER_CONCURRENCY || "5"}`);
console.log(`📊 Load Balancer Strategy: ${process.env.LOAD_BALANCER_STRATEGY || "least-load"}`);

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

const loadBalancerStrategy =
    (process.env.LOAD_BALANCER_STRATEGY as "round-robin" | "least-load") ||
    "least-load";

const worker = new Worker(
    "workflow-run-queue",
    async (job) => {
        try {
            return await processQueueJob({
                job,
                loadBalancerStrategy,
                enableDetailedLogging: true,
            });
        } catch (error: any) {
            // 如果是因为 machine 不可用导致的错误，设置延迟重试
            // 这样 worker 可以继续处理其他 machine 的任务
            if (error?.needsDelayedRetry) {
                const retryCount = (job.data.retryCount || 0) + 1;
                const maxRetries = parseInt(process.env.MAX_QUEUE_RETRIES || "50");

                if (retryCount > maxRetries) {
                    console.error(`❌ [JOB ${job.id}] Machine "${error.machineName}" not available after ${maxRetries} retries`);
                    console.error(`   Marking job as failed to prevent infinite retries`);
                    throw new Error(`Machine "${error.machineName}" not available after ${maxRetries} retries`);
                }

                // 指数退避：随着重试次数增加，延迟时间也增加
                let delayMs = 10000;
                if (retryCount > 20) {
                    delayMs = 60000;
                } else if (retryCount > 10) {
                    delayMs = 30000;
                } else if (retryCount > 5) {
                    delayMs = 20000;
                }

                console.log(`⏰ [JOB ${job.id}] Machine "${error.machineName}" not available, setting delayed retry #${retryCount}/${maxRetries} (${delayMs / 1000}s)`);
                console.log(`   This job will have higher priority when retried (priority will be ${Math.max(1, 6 - retryCount)})`);
                console.log(`   Worker will continue processing jobs for other machines`);

                await job.updateData({
                    ...job.data,
                    retryCount: retryCount,
                });

                await job.moveToDelayed(Date.now() + delayMs, job.token);
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

worker.on("completed", (job) => {
    console.log("\n" + "=".repeat(60));
    console.log(`✅ [JOB ${job.id}] Completed successfully`);
    console.log(`   Completed at: ${new Date().toISOString()}`);
    if (job.returnvalue && typeof job.returnvalue === "object" && "workflow_run_id" in job.returnvalue) {
        console.log(`   Workflow Run ID: ${job.returnvalue.workflow_run_id}`);
    }
    console.log("=".repeat(60) + "\n");
});

worker.on("failed", async (job, err) => {
    console.log("\n" + "=".repeat(60));
    if (job) {
        console.error(`❌ [JOB ${job.id}] Failed`);
        console.error(`   Failed at: ${new Date().toISOString()}`);
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
        console.error(`   Failed at: ${new Date().toISOString()}`);
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

worker.on("active", (job) => {
    console.log(`🔄 [JOB ${job.id}] Job is now active (being processed)`);
});

worker.on("stalled", (jobId) => {
    console.warn(`⚠️  [JOB ${jobId}] Job stalled (may be taking too long)`);
});

// 优雅关闭
process.on("SIGTERM", async () => {
    console.log("SIGTERM received, closing worker...");
    await worker.close();
    await redis.quit();
    process.exit(0);
});

process.on("SIGINT", async () => {
    console.log("SIGINT received, closing worker...");
    await worker.close();
    await redis.quit();
    process.exit(0);
});

// 等待 worker 就绪
worker.on("ready", () => {
    console.log("=".repeat(60));
    console.log("✅ Queue Worker is ready and listening for jobs");
    console.log(`   Queue Name: workflow-run-queue`);
    console.log(`   Concurrency: ${parseInt(process.env.WORKER_CONCURRENCY || "5")}`);
    console.log(`   Load Balancer: ${loadBalancerStrategy}`);
    console.log(`   Ready at: ${new Date().toISOString()}`);
    console.log("=".repeat(60));
    console.log("📝 Worker is now processing jobs...\n");
});

// 检查 Redis 连接
redis.ping()
    .then(() => {
        console.log("✅ Redis ping successful");
    })
    .catch((err) => {
        console.error("❌ Redis ping failed:", err);
        console.error("   Please check if Redis is running and accessible");
    });

console.log("⏳ Waiting for worker to be ready...");

