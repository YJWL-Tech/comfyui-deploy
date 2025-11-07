"use server";

import { db } from "@/db/db";
import { machinesTable } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { syncMachineQueueSize } from "./updateMachineStatus";
import "server-only";

/**
 * 从 ComfyUI 获取队列状态
 * ComfyUI 的 /queue 端点返回队列信息
 */
async function getComfyUIQueueStatus(machineEndpoint: string, authToken?: string): Promise<number> {
    try {
        const headers: HeadersInit = {
            "Content-Type": "application/json",
        };

        if (authToken) {
            headers["Authorization"] = `Bearer ${authToken}`;
        }

        // ComfyUI 的队列端点
        const queueUrl = `${machineEndpoint}/queue`;
        const response = await fetch(queueUrl, {
            method: "GET",
            headers,
            cache: "no-store",
            signal: AbortSignal.timeout(5000), // 5秒超时
        });

        if (!response.ok) {
            console.error(`Failed to fetch queue status from ${machineEndpoint}: ${response.statusText}`);
            return -1; // 返回 -1 表示获取失败
        }

        const data = await response.json();

        // ComfyUI 队列格式: { queue_running: [...], queue_pending: [...] }
        // 返回正在运行和等待中的任务总数
        const running = Array.isArray(data.queue_running) ? data.queue_running.length : 0;
        const pending = Array.isArray(data.queue_pending) ? data.queue_pending.length : 0;

        return running + pending;
    } catch (error) {
        console.error(`Error fetching queue status from ${machineEndpoint}:`, error);
        return -1; // 返回 -1 表示获取失败
    }
}

/**
 * 同步单个机器的队列状态
 */
export async function syncSingleMachineQueue(machineId: string): Promise<{
    success: boolean;
    message: string;
    actualQueueSize?: number;
}> {
    try {
        const machine = await db.query.machinesTable.findFirst({
            where: eq(machinesTable.id, machineId),
        });

        if (!machine) {
            return { success: false, message: "Machine not found" };
        }

        if (machine.disabled) {
            return { success: false, message: "Machine is disabled" };
        }

        // 只同步 classic 类型的机器（ComfyUI 直接部署）
        if (machine.type !== "classic") {
            return { success: false, message: "Only classic machines can be synced" };
        }

        const actualQueueSize = await getComfyUIQueueStatus(
            machine.endpoint,
            machine.auth_token || undefined,
        );

        if (actualQueueSize === -1) {
            return { success: false, message: "Failed to fetch queue status from ComfyUI" };
        }

        // 同步到数据库
        await syncMachineQueueSize(machineId, actualQueueSize);

        return {
            success: true,
            message: "Queue status synced successfully",
            actualQueueSize,
        };
    } catch (error) {
        console.error(`Error syncing machine queue for ${machineId}:`, error);
        return {
            success: false,
            message: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

/**
 * 同步所有可用机器的队列状态
 */
export async function syncAllMachinesQueue(): Promise<{
    success: number;
    failed: number;
    results: Array<{
        machineId: string;
        machineName: string;
        success: boolean;
        message: string;
        actualQueueSize?: number;
    }>;
}> {
    try {
        const machines = await db.query.machinesTable.findMany({
            where: and(
                eq(machinesTable.disabled, false),
                // 只同步 classic 类型的机器
                // @ts-ignore - drizzle 类型问题
                eq(machinesTable.type, "classic"),
            ),
        });

        const results = await Promise.allSettled(
            machines.map(async (machine) => {
                const result = await syncSingleMachineQueue(machine.id);
                return {
                    machineId: machine.id,
                    machineName: machine.name,
                    ...result,
                };
            }),
        );

        const processedResults = results.map((result, index) => {
            if (result.status === "fulfilled") {
                return result.value;
            } else {
                return {
                    machineId: machines[index].id,
                    machineName: machines[index].name,
                    success: false,
                    message: result.reason?.message || "Unknown error",
                };
            }
        });

        const successCount = processedResults.filter((r) => r.success).length;
        const failedCount = processedResults.length - successCount;

        return {
            success: successCount,
            failed: failedCount,
            results: processedResults,
        };
    } catch (error) {
        console.error("Error syncing all machines queue:", error);
        return {
            success: 0,
            failed: 0,
            results: [],
        };
    }
}

