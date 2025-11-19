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
import { auth } from "@clerk/nextjs";
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
    console.log(`[createRun] Starting workflow run creation...`);

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
      status_endpoint: `${origin}/api/update-run`,
      file_upload_endpoint: `${origin}/api/file-upload`,
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

          const ___result = await fetch(`${machine.endpoint}/run`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(_data),
            cache: "no-store",
          });
          console.log(___result);
          if (!___result.ok)
            throw new Error(
              `Error creating run, ${___result.statusText
              } ${await ___result.text()}`,
            );
          console.log(_data, ___result);
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

          const __result = await fetch(`${machine.endpoint}/run`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${machine.auth_token}`,
            },
            body: JSON.stringify(data),
            cache: "no-store",
          });
          console.log(__result);
          if (!__result.ok)
            throw new Error(
              `Error creating run, ${__result.statusText
              } ${await __result.text()}`,
            );
          console.log(data, __result);
          break;
        case "classic":
          const body = {
            ...shareData,
            prompt_id: prompt_id,
          };
          // console.log(body);
          const comfyui_endpoint = `${machine.endpoint}/comfyui-deploy/run`;
          const _result = await fetch(comfyui_endpoint, {
            method: "POST",
            body: JSON.stringify(body),
            cache: "no-store",
          });
          // console.log(_result);

          if (!_result.ok) {
            let message = `Error creating run, ${_result.statusText}`;
            try {
              const result = await ComfyAPI_Run.parseAsync(
                await _result.json(),
              );
              message += ` ${result.node_errors}`;
            } catch (error) { }
            throw new Error(message);
          }
          // prompt_id = result.prompt_id;
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

    return {
      workflow_run_id: workflow_run[0].id,
      message: "Successful workflow run",
    };
  },
);

export async function checkStatus(run_id: string) {
  const { userId } = auth();
  if (!userId) throw new Error("User not found");

  return await getRunsData(run_id);
}
