"use server";

import { auth } from "@clerk/nextjs";
import { db } from "@/db/db";
import { modelPushTasksTable, volumeModelsTable, machinesTable } from "@/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

export async function pushModelsToMachines(params: {
  model_ids: string[];
  machine_ids?: string[];
  machine_group_ids?: string[];
}) {
  const { userId, orgId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized");
  }

  // 注意：更新任务状态的 API 已经去掉认证，不需要 token
  const apiToken = null;

  const { model_ids, machine_ids, machine_group_ids } = params;

  // 验证至少提供一个目标
  if (
    (!machine_ids || machine_ids.length === 0) &&
    (!machine_group_ids || machine_group_ids.length === 0)
  ) {
    throw new Error("至少需要选择一个机器或机器组");
  }

  // 验证模型是否存在且属于当前用户
  const models = await db
    .select()
    .from(volumeModelsTable)
    .where(
      and(
        inArray(volumeModelsTable.id, model_ids),
        eq(volumeModelsTable.user_id, userId)
      )
    );

  if (models.length !== model_ids.length) {
    throw new Error("部分模型不存在或无权访问");
  }

  // 收集所有目标机器
  let targetMachineIds: string[] = [];

  // 添加直接指定的机器
  if (machine_ids && machine_ids.length > 0) {
    targetMachineIds.push(...machine_ids);
  }

  // 添加机器组中的机器
  if (machine_group_ids && machine_group_ids.length > 0) {
    const groupMembers = await db.query.machineGroupMembersTable.findMany({
      where: (members, { inArray }) =>
        inArray(members.group_id, machine_group_ids),
    });

    targetMachineIds.push(...groupMembers.map((m) => m.machine_id));
  }

  // 去重
  targetMachineIds = [...new Set(targetMachineIds)];

  if (targetMachineIds.length === 0) {
    throw new Error("没有找到目标机器");
  }

  // 验证机器是否存在且属于当前用户
  const machines = await db
    .select()
    .from(machinesTable)
    .where(
      and(
        inArray(machinesTable.id, targetMachineIds),
        eq(machinesTable.user_id, userId)
      )
    );

  if (machines.length !== targetMachineIds.length) {
    throw new Error("部分机器不存在或无权访问");
  }

  // 创建推送任务（每个模型 x 每个机器 = 一个任务）
  const tasks = [];
  for (const model_id of model_ids) {
    for (const machine_id of targetMachineIds) {
      tasks.push({
        user_id: userId,
        org_id: orgId || null,
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

  // 立即触发机器下载（不等待完成）
  triggerMachineDownloads(createdTasks, models, machines, apiToken).catch((error) => {
    console.error("Error triggering downloads:", error);
  });

  revalidatePath("/models/push");

  return {
    success: true,
    task_ids: createdTasks.map((t) => t.id),
    message: `成功创建 ${createdTasks.length} 个推送任务，正在通知机器下载`,
  };
}

// 触发机器下载（异步，不阻塞响应）
async function triggerMachineDownloads(
  tasks: any[],
  models: any[],
  machines: any[],
  apiToken: string | null
) {
  const { S3, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

  const s3Client = new S3({
    endpoint: process.env.SPACES_ENDPOINT,
    region: process.env.SPACES_REGION,
    credentials: {
      accessKeyId: process.env.SPACES_KEY!,
      secretAccessKey: process.env.SPACES_SECRET!,
    },
    forcePathStyle: process.env.SPACES_CDN_FORCE_PATH_STYLE === "true",
  });

  // 获取当前服务器的 API URL
  // 优先级：NEXT_PUBLIC_APP_URL > API_URL > 从请求头获取
  let apiUrl: string;
  if (process.env.NEXT_PUBLIC_APP_URL) {
    apiUrl = process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  } else if (process.env.API_URL) {
    apiUrl = process.env.API_URL.replace(/\/$/, "");
  } else {
    const headersList = await headers();
    const host = headersList.get("host") || "";
    const protocol = headersList.get("x-forwarded-proto") || "https";
    apiUrl = `${protocol}://${host}`.replace(/\/$/, "");
  }

  for (const task of tasks) {
    try {
      // 找到对应的模型和机器
      const model = models.find((m) => m.id === task.model_id);
      const machine = machines.find((m) => m.id === task.machine_id);

      if (!model || !machine) {
        console.error(`Model or machine not found for task ${task.id}`);
        continue;
      }

      // 生成 S3 下载 URL
      const command = new GetObjectCommand({
        Bucket: process.env.SPACES_BUCKET,
        Key: model.s3_object_key,
      });

      const downloadUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 60 * 60, // 1小时
      });

      // 调用机器的下载接口
      const machineDownloadUrl = `${machine.endpoint}/comfyui-deploy/model/download`;

      console.log(`Triggering download on machine ${machine.name} for model ${model.filename}`);
      console.log(`Using API URL: ${apiUrl}`);

      fetch(machineDownloadUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          task_id: task.id,
          download_url: downloadUrl,
          folder_path: model.folder_path,
          filename: model.filename,
          api_url: apiUrl, // 使用当前服务器的 API URL
          // auth_token 不再需要，API 已经去掉认证
        }),
      })
        .then((response) => {
          if (response.ok) {
            console.log(`Successfully triggered download for task ${task.id}`);
          } else {
            console.error(
              `Failed to trigger download for task ${task.id}: ${response.status}`
            );
          }
        })
        .catch((error) => {
          console.error(`Error triggering download for task ${task.id}:`, error);
        });
    } catch (error) {
      console.error(`Error processing task ${task.id}:`, error);
    }
  }
}

export async function getPushTasks(filters?: {
  model_id?: string;
  machine_id?: string;
  status?: string;
  limit?: number;
}) {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized");
  }

  const limit = filters?.limit || 50;
  const conditions = [eq(modelPushTasksTable.user_id, userId)];

  if (filters?.model_id) {
    conditions.push(eq(modelPushTasksTable.model_id, filters.model_id));
  }

  if (filters?.machine_id) {
    conditions.push(eq(modelPushTasksTable.machine_id, filters.machine_id));
  }

  if (filters?.status) {
    conditions.push(eq(modelPushTasksTable.status, filters.status));
  }

  const tasks = await db.query.modelPushTasksTable.findMany({
    where: and(...conditions),
    with: {
      model: {
        columns: {
          filename: true,
          folder_path: true,
          file_size: true,
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

  return tasks;
}

export async function getPushTask(taskId: string) {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized");
  }

  const task = await db.query.modelPushTasksTable.findFirst({
    where: and(
      eq(modelPushTasksTable.id, taskId),
      eq(modelPushTasksTable.user_id, userId)
    ),
    with: {
      model: true,
      machine: true,
    },
  });

  if (!task) {
    throw new Error("Task not found");
  }

  return task;
}

export async function deletePushTask(taskId: string) {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Unauthorized");
  }

  await db
    .delete(modelPushTasksTable)
    .where(
      and(
        eq(modelPushTasksTable.id, taskId),
        eq(modelPushTasksTable.user_id, userId)
      )
    );

  revalidatePath("/models/push");

  return { success: true };
}

