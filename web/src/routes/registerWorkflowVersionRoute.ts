import { db } from "@/db/db";
import {
    workflowAPIType,
    workflowTable,
    workflowType,
    workflowVersionTable,
} from "@/db/schema";
import type { App } from "@/routes/app";
import { authError } from "@/routes/authError";
import { createNewWorkflowVersion } from "@/server/createNewWorkflow";
import { getWorkflowVersions } from "@/server/crudWorkflow";
import { z, createRoute } from "@hono/zod-openapi";
import { createSelectSchema } from "drizzle-zod";
import { and, eq, isNull } from "drizzle-orm";

const route = createRoute({
    method: "post",
    path: "/workflow/{workflow_id}/version",
    tags: ["comfyui"],
    summary: "Create a new workflow version",
    description:
        "Create a new version for an existing workflow. This endpoint is used by ComfyUI plugin to save workflow versions.",
    request: {
        params: z.object({
            workflow_id: z.string().uuid(),
        }),
        body: {
            content: {
                "application/json": {
                    schema: z.object({
                        workflow: workflowType,
                        workflow_api: workflowAPIType,
                        comment: z.string().optional(),
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
                        workflow_id: z.string(),
                        version: z.number(),
                    }),
                },
            },
            description: "Successfully created workflow version",
        },
        404: {
            content: {
                "application/json": {
                    schema: z.object({
                        error: z.string(),
                    }),
                },
            },
            description: "Workflow not found",
        },
        500: {
            content: {
                "application/json": {
                    schema: z.object({
                        error: z.string(),
                    }),
                },
            },
            description: "Error when creating workflow version",
        },
        ...authError,
    },
});

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json; charset=utf-8",
};

const versionsRoute = createRoute({
    method: "get",
    path: "/workflow/{workflow_id}/versions",
    tags: ["comfyui"],
    summary: "Get workflow versions list",
    description:
        "Get a paginated list of versions for a specific workflow. Used by ComfyUI plugin to display workflow versions.",
    request: {
        params: z.object({
            workflow_id: z.string().uuid(),
        }),
        query: z.object({
            limit: z.string().optional().default("20"),
            offset: z.string().optional().default("0"),
            search: z.string().optional(),
        }),
    },
    responses: {
        200: {
            content: {
                "application/json": {
                    schema: z.array(
                        z.object({
                            id: z.string(),
                            workflow_id: z.string(),
                            version: z.number(),
                            created_at: z.string(),
                            updated_at: z.string(),
                        })
                    ),
                },
            },
            description: "Successfully retrieved workflow versions",
        },
        500: {
            content: {
                "application/json": {
                    schema: z.object({
                        error: z.string(),
                    }),
                },
            },
            description: "Error when retrieving workflow versions",
        },
    },
});

export const registerWorkflowVersionRoute = (app: App) => {
    app.openapi(route, async (c) => {
        const { workflow_id } = c.req.valid("param");
        const { workflow, workflow_api, comment } = c.req.valid("json");
        const tokenData = c.get("apiKeyTokenData") as
            | { org_id?: string | null; user_id?: string }
            | undefined;

        try {
            // Verify workflow exists; if token present, also verify ownership
            const _workflow = await db
                .select()
                .from(workflowTable)
                .where(
                    tokenData?.user_id
                        ? and(
                            eq(workflowTable.id, workflow_id),
                            eq(workflowTable.user_id, tokenData.user_id),
                            tokenData.org_id
                                ? eq(workflowTable.org_id, tokenData.org_id)
                                : isNull(workflowTable.org_id)
                        )
                        : eq(workflowTable.id, workflow_id)
                );

            if (_workflow.length === 0) {
                return c.json(
                    {
                        error: `Workflow ${workflow_id} not found`,
                    },
                    {
                        status: 404,
                        statusText: "Not Found",
                        headers: {
                            ...corsHeaders,
                            "Content-Type": "application/json; charset=utf-8",
                        },
                    }
                );
            }

            // Create new version
            const { version } = await createNewWorkflowVersion({
                workflow_id: workflow_id,
                workflowData: {
                    workflow,
                    workflow_api,
                    snapshot: null, // Comment is not stored in snapshot for now
                },
            });

            return c.json(
                {
                    workflow_id: workflow_id,
                    version: version,
                },
                {
                    status: 200,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json; charset=utf-8",
                    },
                }
            );
        } catch (error: unknown) {
            const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
            return c.json(
                {
                    error: errorMessage,
                },
                {
                    statusText: "Internal Server Error",
                    status: 500,
                    headers: {
                        ...corsHeaders,
                        "Content-Type": "application/json; charset=utf-8",
                    },
                }
            );
        }
    });

    // Handle OPTIONS for CORS preflight
    app.options("/workflow/:workflow_id/version", async (c) => {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        });
    });

    // Register GET /workflow/{workflow_id}/versions route (no permission check)
    app.openapi(versionsRoute, async (c) => {
        const { workflow_id } = c.req.valid("param");
        const { limit, offset } = c.req.valid("query");

        try {
            const limitNum = parseInt(limit || "20", 10);
            const offsetNum = parseInt(offset || "0", 10);

            const versions = await getWorkflowVersions(
                workflow_id,
                limitNum,
                offsetNum
            );

            return c.json(versions, {
                status: 200,
                headers: corsHeaders,
            });
        } catch (error: unknown) {
            const errorMessage =
                error instanceof Error ? error.message : "Unknown error";

            return c.json(
                {
                    error: errorMessage,
                },
                {
                    statusText: "Internal Server Error",
                    status: 500,
                    headers: corsHeaders,
                }
            );
        }
    });

    // Handle OPTIONS for CORS preflight
    app.options("/workflow/:workflow_id/versions", async (c) => {
        return new Response(null, {
            status: 204,
            headers: corsHeaders,
        });
    });
};

