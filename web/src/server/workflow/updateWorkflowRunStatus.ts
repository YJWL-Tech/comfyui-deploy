"use server";

import { db } from "@/db/db";
import { workflowRunOutputs, workflowRunsTable } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { decrementMachineQueue } from "@/server/machine/updateMachineStatus";
import { sql } from "drizzle-orm";

/**
 * 合并两个 output data 对象
 * 将新数据中的 URL 等信息合并到现有数据中
 */
function mergeOutputData(existingData: any, newData: any): any {
    if (!existingData) return newData;
    if (!newData) return existingData;

    const merged = { ...existingData };

    // 合并 images
    if (newData.images) {
        if (!merged.images) {
            merged.images = [];
        }
        // 根据 filename 匹配并更新 URL
        newData.images.forEach((newImage: any) => {
            const existingIndex = merged.images.findIndex(
                (img: any) => img.filename === newImage.filename
            );
            if (existingIndex >= 0) {
                // 更新现有图片的 URL 和其他属性
                merged.images[existingIndex] = {
                    ...merged.images[existingIndex],
                    ...newImage,
                };
            } else {
                // 添加新图片
                merged.images.push(newImage);
            }
        });
    }

    // 合并 files
    if (newData.files) {
        if (!merged.files) {
            merged.files = [];
        }
        newData.files.forEach((newFile: any) => {
            const existingIndex = merged.files.findIndex(
                (file: any) => file.filename === newFile.filename
            );
            if (existingIndex >= 0) {
                merged.files[existingIndex] = {
                    ...merged.files[existingIndex],
                    ...newFile,
                };
            } else {
                merged.files.push(newFile);
            }
        });
    }

    // 合并 gifs
    if (newData.gifs) {
        if (!merged.gifs) {
            merged.gifs = [];
        }
        newData.gifs.forEach((newGif: any) => {
            const existingIndex = merged.gifs.findIndex(
                (gif: any) => gif.filename === newGif.filename
            );
            if (existingIndex >= 0) {
                merged.gifs[existingIndex] = {
                    ...merged.gifs[existingIndex],
                    ...newGif,
                };
            } else {
                merged.gifs.push(newGif);
            }
        });
    }

    // 合并其他字段（如 text, error 等）
    Object.keys(newData).forEach((key) => {
        if (!["images", "files", "gifs"].includes(key)) {
            merged[key] = newData[key];
        }
    });

    return merged;
}

/**
 * 更新工作流运行状态的共享函数
 * 可以被 API 路由和其他 server actions 直接调用
 */
export async function updateWorkflowRunStatus(
    run_id: string,
    status?: "not-started" | "running" | "uploading" | "success" | "failed",
    output_data?: any,
) {
    // Handle output_data and status independently - they can both be present
    if (output_data) {
        // 检查 output_data 是否为空对象或无效数据
        const hasValidData =
            (output_data.images && Array.isArray(output_data.images) && output_data.images.length > 0) ||
            (output_data.files && Array.isArray(output_data.files) && output_data.files.length > 0) ||
            (output_data.gifs && Array.isArray(output_data.gifs) && output_data.gifs.length > 0) ||
            (output_data.text !== undefined && output_data.text !== null) ||
            (output_data.error !== undefined && output_data.error !== null) ||
            Object.keys(output_data).length > 0 &&
            !(Object.keys(output_data).length === 1 && output_data.images && Array.isArray(output_data.images) && output_data.images.length === 0);

        if (!hasValidData) {
            console.log(`[update-run] Skipping empty output_data for run_id: ${run_id}`);
            // 如果 output_data 是空的，不保存
            if (status) {
                // 继续处理 status
            } else {
                return; // 如果没有 status 也没有有效数据，直接返回
            }
        } else {
            try {
                // 添加调试日志
                console.log(`[update-run] Received output_data for run_id: ${run_id}`);
                console.log(`[update-run] output_data keys:`, Object.keys(output_data));
                if (output_data.images) {
                    console.log(`[update-run] images count: ${output_data.images.length}`);
                    output_data.images.forEach((img: any, idx: number) => {
                        console.log(`[update-run] image[${idx}]: filename=${img.filename}, url=${img.url || 'MISSING'}`);
                    });
                }

                // 查找是否存在相同 run_id 的输出记录
                const existingOutputs = await db
                    .select()
                    .from(workflowRunOutputs)
                    .where(eq(workflowRunOutputs.run_id, run_id));

                console.log(`[update-run] Found ${existingOutputs.length} existing output records`);

                if (existingOutputs.length > 0) {
                    // 合并所有现有记录的数据
                    let mergedData = existingOutputs[0].data;
                    for (let i = 1; i < existingOutputs.length; i++) {
                        mergedData = mergeOutputData(mergedData, existingOutputs[i].data);
                    }

                    console.log(`[update-run] Before merge - existing images count:`, mergedData.images?.length || 0);

                    // 将新数据合并到现有数据中
                    mergedData = mergeOutputData(mergedData, output_data);

                    console.log(`[update-run] After merge - merged images count:`, mergedData.images?.length || 0);
                    if (mergedData.images) {
                        mergedData.images.forEach((img: any, idx: number) => {
                            console.log(`[update-run] merged image[${idx}]: filename=${img.filename}, url=${img.url || 'MISSING'}`);
                        });
                    }

                    // 更新第一条记录，删除其他记录
                    await db
                        .update(workflowRunOutputs)
                        .set({
                            data: mergedData,
                            updated_at: sql`now()`,
                        })
                        .where(eq(workflowRunOutputs.id, existingOutputs[0].id));

                    console.log(`[update-run] Updated output record ${existingOutputs[0].id}`);

                    // 删除其他重复记录
                    if (existingOutputs.length > 1) {
                        const idsToDelete = existingOutputs
                            .slice(1)
                            .map((output) => output.id);
                        await db
                            .delete(workflowRunOutputs)
                            .where(inArray(workflowRunOutputs.id, idsToDelete));
                    }
                } else {
                    // 没有现有记录，创建新记录
                    console.log(`[update-run] No existing records, creating new one`);
                    await db.insert(workflowRunOutputs).values({
                        run_id: run_id,
                        data: output_data,
                    });
                    console.log(`[update-run] Created new output record`);
                }
            } catch (error) {
                console.error(`[update-run] Failed to save output data:`, error);
                throw error;
            }
        }
    }

    if (status) {
        // 先查询当前状态，以便判断是否需要减少队列计数
        const workflowRun = await db.query.workflowRunsTable.findFirst({
            where: eq(workflowRunsTable.id, run_id),
            columns: {
                machine_id: true,
                status: true,
            },
        });

        if (!workflowRun) {
            throw new Error(`Workflow run not found: ${run_id}`);
        }

        const previousStatus = workflowRun?.status;
        const isCompleting =
            (status === "success" || status === "failed") &&
            previousStatus !== "success" &&
            previousStatus !== "failed";

        const endedAt = status === "success" || status === "failed" ? new Date() : null;

        await db
            .update(workflowRunsTable)
            .set({
                status: status,
                ended_at: endedAt,
            })
            .where(eq(workflowRunsTable.id, run_id));

        // 当任务完成（success或failed）时，减少机器的队列计数
        // 这确保队列计数在任务真正完成时才减少，而不是在worker启动任务时
        // 只在状态首次变为success/failed时减少，避免重复减少
        if (isCompleting && workflowRun?.machine_id) {
            await decrementMachineQueue(workflowRun.machine_id);
        }
    }
}

