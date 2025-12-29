"use server";

import { db } from "@/db/db";
import type {
  MachineType,
  WorkflowRunOriginType,
  WorkflowVersionType,
} from "@/db/schema";
import { machinesTable, workflowRunsTable, workflowVersionTable } from "@/db/schema";
import type { APIKeyUserType } from "@/server/APIKeyBodyRequest";
import { getRunsData } from "@/server/getRunsData";
import { ComfyAPI_Run } from "@/types/ComfyAPI_Run";
import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import "server-only";
import { v4 } from "uuid";
import { withServerPromise } from "./withServerPromise";

export const createRun = withServerPromise(
  async ({
    origin,
    workflow_version_id,
    machine_id,
    inputs,
    runOrigin,
    apiUser,
    queueJobId,
  }: {
    origin: string;
    workflow_version_id: string | WorkflowVersionType;
    machine_id: string | MachineType;
    inputs?: Record<string, string | number>;
    runOrigin?: WorkflowRunOriginType;
    apiUser?: APIKeyUserType;
    queueJobId?: string; // 队列任务的 job_id
  }) => {
    // 🔧 关键修复：优先使用 API_URL 环境变量，而不是客户端传入的 origin
    // 客户端传入的 origin 是 window.location.origin（用户访问网页的地址）
    // 但回调地址应该是 API_URL（ComfyUI 能访问到的内网地址）
    const effectiveOrigin = process.env.API_URL || origin;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[createRun] 🚀 Starting workflow run creation...`);
    console.log(`[createRun] 🔧 Environment Check:`);
    console.log(`[createRun]    - process.env.API_URL = "${process.env.API_URL || '(not set)'}"`);
    console.log(`[createRun]    - Received origin param = "${origin}"`);
    console.log(`[createRun]    - ✅ Using effective origin = "${effectiveOrigin}"`);
    console.log(`[createRun] 📍 Callback URLs will be:`);
    console.log(`[createRun]    - status_endpoint: ${effectiveOrigin}/api/update-run`);
    console.log(`[createRun]    - file_upload_endpoint: ${effectiveOrigin}/api/file-upload`);
    console.log(`[createRun] 📋 Run Origin: ${runOrigin || 'not specified'}`);
    console.log(`[createRun] 📋 Queue Job ID: ${queueJobId || 'not specified'}`);
    if (inputs) {
      console.log(`[createRun] 📥 Inputs:`, JSON.stringify(inputs, null, 2));
    }

    const machine =
      typeof machine_id === "string"
        ? await db.query.machinesTable.findFirst({
          where: and(
            eq(machinesTable.id, machine_id),
            eq(machinesTable.disabled, false),
          ),
        })
        : machine_id;

    if (!machine) {
      console.error(`[createRun] ❌ Machine not found: ${typeof machine_id === "string" ? machine_id : machine_id.id}`);
      throw new Error("Machine not found");
    }

    console.log(`[createRun] 🖥️ Machine Info:`);
    console.log(`[createRun]    - ID: ${machine.id}`);
    console.log(`[createRun]    - Name: ${machine.name}`);
    console.log(`[createRun]    - Type: ${machine.type}`);
    console.log(`[createRun]    - Endpoint: ${machine.endpoint}`);

    const workflow_version_data =
      typeof workflow_version_id === "string"
        ? await db.query.workflowVersionTable.findFirst({
          where: eq(workflowVersionTable.id, workflow_version_id),
          with: {
            workflow: {
              columns: {
                org_id: true,
                user_id: true,
              },
            },
          },
        })
        : workflow_version_id;

    if (!workflow_version_data) {
      console.error(
        `[createRun] ❌ Workflow version not found: ${typeof workflow_version_id === "string" ? workflow_version_id : workflow_version_id.id}`,
      );
      throw new Error("Workflow version not found");
    }

    // 如果是从队列 worker 执行的（有 queueJobId），完全跳过权限检查
    // 因为权限已经在 API 层面（添加任务到队列时）检查过了
    if (queueJobId) {
      // 跳过权限检查，不输出日志
    } else if (apiUser) {
      // 权限检查（仅直接 API 调用时）

      if (apiUser.org_id) {
        // is org api call, check org only
        if (apiUser.org_id != workflow_version_data.workflow.org_id) {
          console.error(`[createRun] ❌ Permission denied: Org ID mismatch`);
          throw new Error("Workflow not found");
        }
      } else {
        // is user api call, check user only
        if (
          apiUser.user_id != workflow_version_data.workflow.user_id &&
          workflow_version_data.workflow.org_id == null
        ) {
          console.error(`[createRun] ❌ Permission denied: User ID mismatch`);
          throw new Error("Workflow not found");
        }
      }
    }

    const workflow_api = workflow_version_data.workflow_api;

    // Note: workflow_version_data.workflow is the relation to workflowTable (contains org_id, user_id)
    // We need to get the actual workflow JSON from workflowVersionTable
    // Since the relation name "workflow" overrides the column, we need to query it separately
    let workflowJson = null;
    if (typeof workflow_version_id === "string") {
      const versionWithWorkflow = await db.query.workflowVersionTable.findFirst({
        where: eq(workflowVersionTable.id, workflow_version_id),
        columns: {
          workflow: true,
        },
      });
      workflowJson = versionWithWorkflow?.workflow ?? null;
    } else {
      // If workflow_version_id is already a WorkflowVersionType object, it might have the workflow field
      // but we need to be careful about the relation override
      workflowJson = (workflow_version_id as any).workflow;
      // Check if it's actually the workflow JSON (should have 'nodes' key) or the relation object
      if (workflowJson && typeof workflowJson === 'object' && !('nodes' in workflowJson)) {
        // It's the relation object, not the workflow JSON - query it separately
        const versionWithWorkflow = await db.query.workflowVersionTable.findFirst({
          where: eq(workflowVersionTable.id, workflow_version_id.id),
          columns: {
            workflow: true,
          },
        });
        workflowJson = versionWithWorkflow?.workflow ?? null;
      }
    }

    // Replace the inputs
    if (inputs && workflow_api) {
      for (const key in inputs) {
        Object.entries(workflow_api).forEach(([_, node]) => {
          if (node.inputs["input_id"] === key) {
            node.inputs["input_id"] = inputs[key];
            // Fix for external text default value
            if (node.class_type == "ComfyUIDeployExternalText") {
              node.inputs["default_value"] = inputs[key];
            }
          }

        });
      }
    }

    let prompt_id: string | undefined = undefined;
    const shareData = {
      workflow_api_raw: workflow_api,
      workflow: workflowJson,
      status_endpoint: `${effectiveOrigin}/api/update-run`,
      file_upload_endpoint: `${effectiveOrigin}/api/file-upload`,
    };

    prompt_id = v4();

    // Add to our db

    const workflow_run = await db
      .insert(workflowRunsTable)
      .values({
        id: prompt_id,
        workflow_id: workflow_version_data.workflow_id,
        workflow_version_id: workflow_version_data.id,
        workflow_inputs: inputs,
        machine_id: machine.id,
        origin: runOrigin,
        queue_job_id: queueJobId,
      })
      .returning();

    console.log(`[createRun] ✅ Workflow run record created: ${workflow_run[0].id}`);

    revalidatePath(`/${workflow_version_data.workflow_id}`);

    try {
      switch (machine.type) {
        case "comfy-deploy-serverless":
        case "modal-serverless":
          const _data = {
            input: {
              ...shareData,
              prompt_id: prompt_id,
            },
          };

          console.log(`\n[createRun] 📤 Sending request to ComfyUI (${machine.type} mode):`);
          console.log(`[createRun]    - Target URL: ${machine.endpoint}/run`);
          console.log(`[createRun]    - Method: POST`);
          console.log(`[createRun]    - Request Body:`);
          console.log(`[createRun]      prompt_id: ${_data.input.prompt_id}`);
          console.log(`[createRun]      status_endpoint: ${_data.input.status_endpoint}`);
          console.log(`[createRun]      file_upload_endpoint: ${_data.input.file_upload_endpoint}`);

          const ___result = await fetch(`${machine.endpoint}/run`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(_data),
            cache: "no-store",
          });

          console.log(`[createRun] 📥 Response: ${___result.status} ${___result.statusText}`);
          if (!___result.ok) {
            const errorText = await ___result.text();
            console.error(`[createRun] ❌ Error response:`, errorText);
            throw new Error(`Error creating run, ${___result.statusText} ${errorText}`);
          }
          console.log(`[createRun] ✅ Request sent successfully`);
          break;
        case "runpod-serverless":
          const data = {
            input: {
              ...shareData,
              prompt_id: prompt_id,
            },
          };

          if (
            !machine.auth_token &&
            !machine.endpoint.includes("localhost") &&
            !machine.endpoint.includes("127.0.0.1")
          ) {
            throw new Error("Machine auth token not found");
          }

          console.log(`\n[createRun] 📤 Sending request to ComfyUI (runpod-serverless mode):`);
          console.log(`[createRun]    - Target URL: ${machine.endpoint}/run`);
          console.log(`[createRun]    - Method: POST`);
          console.log(`[createRun]    - Auth: Bearer token ${machine.auth_token ? '[present]' : '[missing]'}`);
          console.log(`[createRun]    - Request Body:`);
          console.log(`[createRun]      prompt_id: ${data.input.prompt_id}`);
          console.log(`[createRun]      status_endpoint: ${data.input.status_endpoint}`);
          console.log(`[createRun]      file_upload_endpoint: ${data.input.file_upload_endpoint}`);

          const __result = await fetch(`${machine.endpoint}/run`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${machine.auth_token}`,
            },
            body: JSON.stringify(data),
            cache: "no-store",
          });

          console.log(`[createRun] 📥 Response: ${__result.status} ${__result.statusText}`);
          if (!__result.ok) {
            const errorText = await __result.text();
            console.error(`[createRun] ❌ Error response:`, errorText);
            throw new Error(`Error creating run, ${__result.statusText} ${errorText}`);
          }
          console.log(`[createRun] ✅ Request sent successfully`);
          break;
        case "classic":
          const body = {
            ...shareData,
            prompt_id: prompt_id,
          };
          const comfyui_endpoint = `${machine.endpoint}/comfyui-deploy/run`;

          console.log(`\n[createRun] 📤 Sending request to ComfyUI (classic mode):`);
          console.log(`[createRun]    - Target URL: ${comfyui_endpoint}`);
          console.log(`[createRun]    - Method: POST`);
          console.log(`[createRun]    - Request Body:`);
          console.log(`[createRun]      prompt_id: ${body.prompt_id}`);
          console.log(`[createRun]      status_endpoint: ${body.status_endpoint}`);
          console.log(`[createRun]      file_upload_endpoint: ${body.file_upload_endpoint}`);
          console.log(`[createRun]      workflow_api_raw: ${body.workflow_api_raw ? '[workflow data present]' : '[null]'}`);
          console.log(`[createRun]      workflow: ${body.workflow ? '[workflow json present]' : '[null]'}`);

          const _result = await fetch(comfyui_endpoint, {
            method: "POST",
            body: JSON.stringify(body),
            cache: "no-store",
          });

          console.log(`[createRun] 📥 Response from ComfyUI:`);
          console.log(`[createRun]    - Status: ${_result.status} ${_result.statusText}`);

          if (!_result.ok) {
            let message = `Error creating run, ${_result.statusText}`;
            try {
              const result = await ComfyAPI_Run.parseAsync(
                await _result.json(),
              );
              message += ` ${result.node_errors}`;
              console.error(`[createRun] ❌ ComfyUI returned error:`, result);
            } catch (error) { }
            throw new Error(message);
          }
          console.log(`[createRun] ✅ Request sent successfully to ComfyUI`);
          break;
      }
    } catch (e) {
      console.error(e);
      const errorMessage = e instanceof Error ? e.message : String(e);
      await db
        .update(workflowRunsTable)
        .set({
          status: "failed",
          ended_at: new Date(),
        })
        .where(eq(workflowRunsTable.id, workflow_run[0].id));

      // 发送失败通知
      try {
        const { sendWebhookNotification, buildWebhookPayload } = await import("@/server/notifications/webhook-notifier");
        const payload = await buildWebhookPayload(
          workflow_run[0].id,
          "failed",
          errorMessage,
        );
        // 异步发送，不阻塞主流程
        sendWebhookNotification(payload).catch(err => {
          console.error(`[createRun] Failed to send notification for run ${workflow_run[0].id}:`, err);
        });
      } catch (notificationError) {
        console.error(`[createRun] Error setting up notification for run ${workflow_run[0].id}:`, notificationError);
        // 不抛出错误，避免影响主流程
      }

      throw e;
    }

    // It successfully started, update the started_at time and status to running
    await db
      .update(workflowRunsTable)
      .set({
        started_at: new Date(),
        status: "running", // 立即更新状态为 running，表示任务已在 ComfyUI 中开始执行
      })
      .where(eq(workflowRunsTable.id, workflow_run[0].id));

    console.log(`\n[createRun] 🎉 Workflow run created successfully!`);
    console.log(`[createRun]    - Run ID: ${workflow_run[0].id}`);
    console.log(`[createRun]    - ComfyUI will callback to: ${effectiveOrigin}`);
    console.log(`${"=".repeat(60)}\n`);

    return {
      workflow_run_id: workflow_run[0].id,
      message: "Successful workflow run",
    };
  },
);

export async function checkStatus(run_id: string) {
  const { userId } = await auth();
  if (!userId) throw new Error("User not found");

  return await getRunsData(run_id);
}
