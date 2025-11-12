/**
 * Webhook 通知服务
 * 当 workflow run 完成时，将通知任务加入队列（解耦设计）
 * 实际发送由独立的 notification-worker 处理
 */

import { enqueueNotification } from "./notification-queue";
import type { NotificationPayload } from "./notification-queue";

interface WebhookPayload {
    workflow_run_id: string;
    status: "success" | "failed";
    job_id?: string;
    deployment_id?: string;
    outputs?: any;
    error?: string;
    completed_at: string;
}

/**
 * 将 webhook 通知加入队列（异步、解耦）
 * 这样即使目标服务（如 Strapi）重启，通知也会保留在队列中等待重试
 */
export async function sendWebhookNotification(payload: WebhookPayload) {
    const webhookUrl = process.env.WEBHOOK_NOTIFICATION_URL;

    console.log(`[Webhook] sendWebhookNotification called for run ${payload.workflow_run_id}`);
    console.log(`[Webhook] WEBHOOK_NOTIFICATION_URL: ${webhookUrl || "NOT SET"}`);

    if (!webhookUrl) {
        console.log("[Webhook] WEBHOOK_NOTIFICATION_URL not configured, skipping notification");
        return;
    }

    try {
        // 将通知任务加入队列，而不是直接发送
        // 这样即使 Strapi 重启，任务也会保留在队列中等待重试
        const notificationPayload: NotificationPayload = {
            ...payload,
            webhook_url: webhookUrl,
            webhook_auth_header: process.env.WEBHOOK_AUTHORIZATION_HEADER,
        };

        console.log(`[Webhook] Enqueueing notification to queue...`);
        console.log(`[Webhook] Payload:`, JSON.stringify(notificationPayload, null, 2));

        const job = await enqueueNotification(notificationPayload);
        console.log(`[Webhook] ✅ Notification enqueued successfully for run ${payload.workflow_run_id}`);
        console.log(`[Webhook] Job ID: ${job.id}`);
        console.log(`[Webhook] ⚠️  Note: Notification will only be sent if Notification Worker is running!`);
        console.log(`[Webhook] ⚠️  Check /notifications page to ensure worker is started.`);
    } catch (error) {
        console.error("[Webhook] ❌ Error enqueueing notification:", error);
        console.error("[Webhook] Error details:", error instanceof Error ? error.stack : String(error));
        // 不抛出错误，避免影响主流程
    }
}

/**
 * 从 workflow run 数据构建 webhook payload
 */
export async function buildWebhookPayload(
    run_id: string,
    status: "success" | "failed",
    error?: string
): Promise<WebhookPayload> {
    const { db } = await import("@/db/db");
    const { workflowRunsTable } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { getRunsData } = await import("@/server/getRunsData");

    // 获取完整的 run 数据
    const runData = await getRunsData(run_id);

    if (!runData) {
        throw new Error(`Workflow run not found: ${run_id}`);
    }

    // 获取 outputs
    const outputs = runData.outputs?.map(output => output.data) || [];

    // 尝试从 deployment 关联获取 deployment_id
    let deployment_id: string | undefined = undefined;
    if (runData.workflow_id) {
        try {
            const { db } = await import("@/db/db");
            const { deploymentsTable } = await import("@/db/schema");
            const { eq } = await import("drizzle-orm");

            const deployment = await db.query.deploymentsTable.findFirst({
                where: eq(deploymentsTable.workflow_id, runData.workflow_id),
                columns: { id: true },
            });
            if (deployment) {
                deployment_id = deployment.id;
            }
        } catch (error) {
            // 忽略错误，deployment_id 为可选字段
            console.log(`[Webhook] Could not get deployment_id for run ${run_id}:`, error);
        }
    }

    return {
        workflow_run_id: run_id,
        status,
        job_id: runData.queue_job_id || undefined,
        deployment_id,
        outputs: outputs.length > 0 ? outputs : undefined,
        error,
        completed_at: runData.ended_at?.toISOString() || new Date().toISOString(),
    };
}

