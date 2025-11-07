import { db } from "@/db/db";
import { deploymentsTable } from "@/db/schema";
import type { App } from "@/routes/app";
import { authError } from "@/routes/authError";
import { createRoute, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { addJobToQueue, getQueueStatus, getJobStatus } from "../server/queue/queue-client";

const queueRunRoute = createRoute({
    method: "post",
    path: "/queue/run",
    tags: ["queue"],
    summary: "Queue a workflow run",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: z.object({
                        deployment_id: z.string(),
                        inputs: z.record(z.union([z.string(), z.number()])).optional(),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        job_id: z.string(),
                        status: z.string(),
                        estimated_wait_time: z.number().optional(),
                    }),
                },
            },
            description: "Job queued successfully",
        },
        ...authError,
    },
});

export const registerQueueRoute = (app: App) => {
    app.openapi(queueRunRoute, async (c) => {
        const data = c.req.valid("json");
        const apiKeyTokenData = c.get("apiKeyTokenData")!;

        // 验证deployment存在
        const deployment = await db.query.deploymentsTable.findFirst({
            where: eq(deploymentsTable.id, data.deployment_id),
            with: {
                version: {
                    with: {
                        workflow: {
                            columns: {
                                org_id: true,
                                user_id: true,
                            },
                        },
                    },
                },
            },
        });

        if (!deployment) {
            return c.json({ error: "Deployment not found" }, 404);
        }

        // 权限检查
        if (apiKeyTokenData.org_id) {
            if (apiKeyTokenData.org_id !== deployment.version.workflow.org_id) {
                return c.json({ error: "Unauthorized" }, 403);
            }
        } else {
            if (
                apiKeyTokenData.user_id !== deployment.version.workflow.user_id &&
                deployment.version.workflow.org_id == null
            ) {
                return c.json({ error: "Unauthorized" }, 403);
            }
        }

        // Staging环境只能使用machine_id，不能使用machine_group_id
        if (deployment.environment === "staging" && deployment.machine_group_id) {
            return c.json(
                {
                    error:
                        "Staging environment can only use machine_id, not machine_group_id",
                },
                400,
            );
        }

        const proto = c.req.headers.get("x-forwarded-proto") || "http";
        const host =
            c.req.headers.get("x-forwarded-host") || c.req.headers.get("host");
        const origin = `${proto}://${host}`;

        // 加入队列
        const job = await addJobToQueue({
            deployment_id: data.deployment_id,
            inputs: data.inputs,
            origin,
            apiUser: apiKeyTokenData.user_id
                ? {
                    user_id: apiKeyTokenData.user_id,
                    org_id: apiKeyTokenData.org_id || undefined,
                }
                : undefined,
        });

        // 估算等待时间（简单实现）
        const queueStatus = await getQueueStatus();
        const estimatedWaitTime = queueStatus.waiting * 30; // 假设每个任务30秒

        return c.json({
            job_id: job.id!,
            status: "queued",
            estimated_wait_time: estimatedWaitTime,
        });
    });
};

// 查询任务状态的 API
const queueStatusRoute = createRoute({
    method: "get",
    path: "/queue/status/{job_id}",
    tags: ["queue"],
    summary: "Get queue job status by job_id",
    request: {
        params: z.object({
            job_id: z.string(),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        job_id: z.string(),
                        queue_status: z.string(),
                        workflow_run_id: z.string().optional(),
                        workflow_status: z.string().optional(),
                        progress: z.any().optional(),
                        failed_reason: z.string().optional(),
                        created_at: z.string().optional(),
                        started_at: z.string().optional().nullable(),
                        ended_at: z.string().optional().nullable(),
                        processed_on: z.string().optional().nullable(),
                        finished_on: z.string().optional().nullable(),
                        message: z.string().optional(),
                    }),
                },
            },
            description: "Job status retrieved successfully",
        },
        ...authError,
    },
});

export const registerQueueStatusRoute = (app: App) => {
    app.openapi(queueStatusRoute, async (c) => {
        const { job_id } = c.req.valid("param");
        const apiKeyTokenData = c.get("apiKeyTokenData")!;

        const jobStatus = await getJobStatus(job_id);

        // 如果找到了 workflow_run_id，检查权限
        if (jobStatus.workflow_run_id) {
            const { db } = await import("@/db/db");
            const { workflowRunsTable } = await import("@/db/schema");
            const { eq } = await import("drizzle-orm");

            const workflowRun = await db.query.workflowRunsTable.findFirst({
                where: eq(workflowRunsTable.id, jobStatus.workflow_run_id),
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
                // 权限检查
                if (apiKeyTokenData.org_id) {
                    if (apiKeyTokenData.org_id !== workflowRun.workflow.org_id) {
                        return c.json({ error: "Unauthorized" }, 403);
                    }
                } else {
                    if (
                        apiKeyTokenData.user_id !== workflowRun.workflow.user_id &&
                        workflowRun.workflow.org_id == null
                    ) {
                        return c.json({ error: "Unauthorized" }, 403);
                    }
                }

                // 如果 workflow_run 存在，添加详细信息
                const { getRunsData } = await import("@/server/getRunsData");
                // 类型转换：apiKeyTokenData 可能包含 iat/exp，但 getRunsData 只需要 user_id 和 org_id
                const runData = await getRunsData(
                    jobStatus.workflow_run_id,
                    apiKeyTokenData.user_id
                        ? (apiKeyTokenData as any)
                        : undefined,
                );

                return c.json({
                    ...jobStatus,
                    workflow_run: runData,
                });
            }
        }

        return c.json(jobStatus);
    });
};

