import type { App } from "@/routes/app";
import { authError } from "@/routes/authError";
import { z, createRoute } from "@hono/zod-openapi";
import { db } from "@/db/db";
import {
    volumeModelsTable,
    modelPushTasksTable,
    machinesTable,
    machineGroupsTable,
    machineGroupMembersTable,
} from "@/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
};

// 发起模型推送
const pushModelRoute = createRoute({
    method: "post",
    path: "/volume/model/push",
    tags: ["volume"],
    summary: "Push models to machines or machine groups",
    description:
        "Initiate a push task to download models from S3 to target machines",
    request: {
        body: {
            content: {
                "application/json": {
                    schema: z.object({
                        model_ids: z.array(z.string().uuid()).min(1),
                        machine_ids: z.array(z.string().uuid()).optional(),
                        machine_group_ids: z.array(z.string().uuid()).optional(),
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
                        success: z.boolean(),
                        task_ids: z.array(z.string()),
                        message: z.string(),
                    }),
                },
            },
            description: "Push tasks created successfully",
        },
        400: {
            content: {
                "application/json": {
                    schema: z.object({
                        error: z.string(),
                    }),
                },
            },
            description: "Bad request",
        },
        500: {
            content: {
                "application/json": {
                    schema: z.object({
                        error: z.string(),
                    }),
                },
            },
            description: "Error creating push tasks",
        },
        ...authError,
    },
});

// 查询推送任务状态
const getPushTaskRoute = createRoute({
    method: "get",
    path: "/volume/model/push/{task_id}",
    tags: ["volume"],
    summary: "Get push task status",
    description: "Get the status of a specific push task",
    request: {
        params: z.object({
            task_id: z.string().uuid(),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        id: z.string(),
                        model_id: z.string(),
                        machine_id: z.string().nullable(),
                        machine_group_id: z.string().nullable(),
                        status: z.string(),
                        progress: z.number().nullable(),
                        error_message: z.string().nullable(),
                        started_at: z.string().nullable(),
                        completed_at: z.string().nullable(),
                        created_at: z.string(),
                    }),
                },
            },
            description: "Push task retrieved successfully",
        },
        404: {
            content: {
                "application/json": {
                    schema: z.object({
                        error: z.string(),
                    }),
                },
            },
            description: "Task not found",
        },
        ...authError,
    },
});

// 获取推送任务列表
const listPushTasksRoute = createRoute({
    method: "get",
    path: "/volume/model/push/list",
    tags: ["volume"],
    summary: "List push tasks",
    description: "Get a list of all push tasks for the user",
    request: {
        query: z.object({
            model_id: z.string().uuid().optional(),
            machine_id: z.string().uuid().optional(),
            status: z.string().optional(),
            limit: z.string().optional(),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.object({
                        tasks: z.array(
                            z.object({
                                id: z.string(),
                                model_id: z.string(),
                                machine_id: z.string().nullable(),
                                machine_group_id: z.string().nullable(),
                                status: z.string(),
                                progress: z.number().nullable(),
                                error_message: z.string().nullable(),
                                created_at: z.string(),
                                model: z
                                    .object({
                                        filename: z.string(),
                                        folder_path: z.string(),
                                    })
                                    .optional(),
                                machine: z
                                    .object({
                                        name: z.string(),
                                    })
                                    .optional()
                                    .nullable(),
                            })
                        ),
                    }),
                },
            },
            description: "Tasks retrieved successfully",
        },
        ...authError,
    },
});

// 更新推送任务状态（供 ComfyUI 机器调用，无需认证）
const updatePushTaskRoute = createRoute({
    method: "patch",
    path: "/volume/model/push/{task_id}",
    tags: ["volume"],
    summary: "Update push task status",
    description: "Update the status and progress of a push task (called by ComfyUI machines, no auth required)",
    request: {
        params: z.object({
            task_id: z.string().uuid(),
        }),
        body: {
            content: {
                "application/json": {
                    schema: z.object({
                        status: z
                            .enum(["pending", "downloading", "completed", "failed"])
                            .optional(),
                        progress: z.number().min(0).max(100).optional(),
                        error_message: z.string().optional(),
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
                        success: z.boolean(),
                    }),
                },
            },
            description: "Task updated successfully",
        },
        404: {
            content: {
                "application/json": {
                    schema: z.object({
                        error: z.string(),
                    }),
                },
            },
            description: "Task not found",
        },
    },
});

export const registerModelPushRoute = (app: App) => {
    // 发起模型推送
    app.openapi(pushModelRoute, async (c) => {
        const { model_ids, machine_ids, machine_group_ids } = c.req.valid("json");
        const tokenData = c.get("apiKeyTokenData");

        if (!tokenData?.user_id) {
            return c.json(
                { error: "Invalid user_id" },
                { status: 500, headers: corsHeaders }
            );
        }

        // 验证至少提供一个目标
        if (
            (!machine_ids || machine_ids.length === 0) &&
            (!machine_group_ids || machine_group_ids.length === 0)
        ) {
            return c.json(
                { error: "At least one machine_id or machine_group_id is required" },
                { status: 400, headers: corsHeaders }
            );
        }

        try {
            // 验证模型是否存在且属于当前用户
            const models = await db
                .select()
                .from(volumeModelsTable)
                .where(
                    and(
                        inArray(volumeModelsTable.id, model_ids),
                        eq(volumeModelsTable.user_id, tokenData.user_id)
                    )
                );

            if (models.length !== model_ids.length) {
                return c.json(
                    { error: "Some models not found or unauthorized" },
                    { status: 400, headers: corsHeaders }
                );
            }

            // 收集所有目标机器
            let targetMachineIds: string[] = [];

            // 添加直接指定的机器
            if (machine_ids && machine_ids.length > 0) {
                targetMachineIds.push(...machine_ids);
            }

            // 添加机器组中的机器
            if (machine_group_ids && machine_group_ids.length > 0) {
                const groupMembers = await db
                    .select({ machine_id: machineGroupMembersTable.machine_id })
                    .from(machineGroupMembersTable)
                    .where(inArray(machineGroupMembersTable.group_id, machine_group_ids));

                targetMachineIds.push(
                    ...groupMembers.map((m) => m.machine_id as string)
                );
            }

            // 去重
            targetMachineIds = [...new Set(targetMachineIds)];

            if (targetMachineIds.length === 0) {
                return c.json(
                    { error: "No target machines found" },
                    { status: 400, headers: corsHeaders }
                );
            }

            // 验证机器是否存在且属于当前用户
            const machines = await db
                .select()
                .from(machinesTable)
                .where(
                    and(
                        inArray(machinesTable.id, targetMachineIds),
                        eq(machinesTable.user_id, tokenData.user_id)
                    )
                );

            if (machines.length !== targetMachineIds.length) {
                return c.json(
                    { error: "Some machines not found or unauthorized" },
                    { status: 400, headers: corsHeaders }
                );
            }

            // 创建推送任务（每个模型 x 每个机器 = 一个任务）
            const tasks = [];
            for (const model_id of model_ids) {
                for (const machine_id of targetMachineIds) {
                    tasks.push({
                        user_id: tokenData.user_id,
                        org_id: tokenData.org_id || null,
                        model_id,
                        machine_id,
                        status: "pending",
                        progress: 0,
                    });
                }
            }

            const createdTasks = await db
                .insert(modelPushTasksTable)
                .values(tasks)
                .returning();

            // TODO: 这里可以触发异步任务去通知各个机器开始下载
            // 例如通过 WebSocket 或者轮询机制

            return c.json(
                {
                    success: true,
                    task_ids: createdTasks.map((t) => t.id),
                    message: `Created ${createdTasks.length} push tasks`,
                },
                { status: 200, headers: corsHeaders }
            );
        } catch (error: unknown) {
            const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
            return c.json(
                { error: errorMessage },
                { status: 500, headers: corsHeaders }
            );
        }
    });

    // 获取单个推送任务
    app.openapi(getPushTaskRoute, async (c) => {
        const { task_id } = c.req.valid("param");
        const tokenData = c.get("apiKeyTokenData");

        if (!tokenData?.user_id) {
            return c.json(
                { error: "Invalid user_id" },
                { status: 500, headers: corsHeaders }
            );
        }

        try {
            const task = await db.query.modelPushTasksTable.findFirst({
                where: and(
                    eq(modelPushTasksTable.id, task_id),
                    eq(modelPushTasksTable.user_id, tokenData.user_id)
                ),
            });

            if (!task) {
                return c.json(
                    { error: "Task not found" },
                    { status: 404, headers: corsHeaders }
                );
            }

            return c.json(task, { status: 200, headers: corsHeaders });
        } catch (error: unknown) {
            const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
            return c.json(
                { error: errorMessage },
                { status: 500, headers: corsHeaders }
            );
        }
    });

    // 获取推送任务列表
    app.openapi(listPushTasksRoute, async (c) => {
        const query = c.req.valid("query");
        const tokenData = c.get("apiKeyTokenData");

        if (!tokenData?.user_id) {
            return c.json(
                { error: "Invalid user_id" },
                { status: 500, headers: corsHeaders }
            );
        }

        try {
            const limit = query.limit ? parseInt(query.limit) : 50;
            const conditions = [eq(modelPushTasksTable.user_id, tokenData.user_id)];

            if (query.model_id) {
                conditions.push(eq(modelPushTasksTable.model_id, query.model_id));
            }

            if (query.machine_id) {
                conditions.push(eq(modelPushTasksTable.machine_id, query.machine_id));
            }

            if (query.status) {
                conditions.push(eq(modelPushTasksTable.status, query.status));
            }

            const tasks = await db.query.modelPushTasksTable.findMany({
                where: and(...conditions),
                with: {
                    model: {
                        columns: {
                            filename: true,
                            folder_path: true,
                        },
                    },
                    machine: {
                        columns: {
                            name: true,
                        },
                    },
                },
                orderBy: desc(modelPushTasksTable.created_at),
                limit,
            });

            return c.json({ tasks }, { status: 200, headers: corsHeaders });
        } catch (error: unknown) {
            const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
            return c.json(
                { error: errorMessage },
                { status: 500, headers: corsHeaders }
            );
        }
    });

    // 更新推送任务状态（无需认证，供 ComfyUI 机器调用）
    app.openapi(updatePushTaskRoute, async (c) => {
        const { task_id } = c.req.valid("param");
        const updates = c.req.valid("json");

        console.log(`[Model Push] Received update request for task ${task_id}:`, {
            status: updates.status,
            progress: updates.progress,
            error_message: updates.error_message,
            method: c.req.method,
            path: c.req.path,
            url: c.req.url,
        });

        try {
            // 构建更新对象
            const updateData: any = {
                updated_at: new Date(),
            };

            if (updates.status) {
                updateData.status = updates.status;
                if (updates.status === "downloading" && !updateData.started_at) {
                    updateData.started_at = new Date();
                }
                if (
                    (updates.status === "completed" || updates.status === "failed") &&
                    !updateData.completed_at
                ) {
                    updateData.completed_at = new Date();
                }
            }

            if (updates.progress !== undefined) {
                updateData.progress = updates.progress;
            }

            if (updates.error_message !== undefined) {
                updateData.error_message = updates.error_message;
            }

            const result = await db
                .update(modelPushTasksTable)
                .set(updateData)
                .where(eq(modelPushTasksTable.id, task_id))
                .returning();

            if (result.length === 0) {
                console.log(`[Model Push] Task ${task_id} not found`);
                return c.json(
                    { error: "Task not found" },
                    { status: 404, headers: corsHeaders }
                );
            }

            console.log(`[Model Push] Successfully updated task ${task_id}:`, {
                status: result[0].status,
                progress: result[0].progress,
            });

            return c.json({ success: true }, { status: 200, headers: corsHeaders });
        } catch (error: unknown) {
            const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
            console.error(`[Model Push] Error updating task ${task_id}:`, errorMessage, error);
            return c.json(
                { error: errorMessage },
                { status: 500, headers: corsHeaders }
            );
        }
    });

    // Handle OPTIONS for CORS preflight
    app.options("/volume/model/push", async (c) => {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        });
    });

    app.options("/volume/model/push/:task_id", async (c) => {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        });
    });

    app.options("/volume/model/push/list", async (c) => {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        });
    });
};

