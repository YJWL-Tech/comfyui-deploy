"use server";

import { db } from "@/db/db";
import { workflowRunOutputs, workflowRunsTable } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { decrementMachineQueue } from "@/server/machine/updateMachineStatus";
import { sql } from "drizzle-orm";

// 重试配置
const EXECUTION_RETRY_ENABLED = process.env.COMFYUI_EXECUTION_RETRY_ENABLED === "true";
const RETRY_DELAY_MS = parseInt(process.env.COMFYUI_EXECUTION_RETRY_DELAY_MS || "5000");

/**
 * 判断错误类型是否应该重试
 * 某些错误（如参数错误、节点未找到）不应该重试
 */
function shouldRetryError(output_data: any): boolean {
    if (!output_data?.error) {
        return true; // 没有具体错误信息，默认重试
    }

    const errorType = (output_data.error?.error_type || "").toLowerCase();
    const errorMessage = (output_data.error?.message || output_data.error?.stack_trace || "").toLowerCase();

    // 不应该重试的错误类型
    const nonRetryablePatterns = [
        "value_error",       // 参数错误
        "valueerror",        // Python ValueError
        "node_not_found",    // 节点未找到
        "invalid_workflow",  // 工作流无效
        "missing_node",      // 缺少节点
        "invalid_input",     // 无效输入
        "type_error",        // 类型错误
        "typeerror",         // Python TypeError
    ];

    for (const pattern of nonRetryablePatterns) {
        if (errorType.includes(pattern) || errorMessage.includes(pattern)) {
            console.log(`[retry] Error pattern "${pattern}" found, not retryable`);
            return false;
        }
    }

    return true;
}

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
        // 先查询当前状态，以便判断是否需要减少队列计数和是否需要重试
        const workflowRun = await db.query.workflowRunsTable.findFirst({
            where: eq(workflowRunsTable.id, run_id),
            columns: {
                machine_id: true,
                status: true,
                retry_count: true,
                max_retries: true,
                workflow_version_id: true,
                workflow_inputs: true,
                origin: true,
                queue_job_id: true,
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

        // 检查是否需要重试（仅在失败时）
        if (status === "failed" && isCompleting && EXECUTION_RETRY_ENABLED) {
            const currentRetryCount = workflowRun.retry_count || 0;
            const maxRetries = workflowRun.max_retries || 0;

            // 检查是否还有重试次数，以及错误类型是否可重试
            if (maxRetries > 0 && currentRetryCount < maxRetries && shouldRetryError(output_data)) {
                console.log(`[retry] Triggering retry for run ${run_id} (attempt ${currentRetryCount + 1}/${maxRetries})`);

                // 增加重试计数，但先不更新状态（保持当前状态，等重试真正开始时再重置）
                const newRetryCount = currentRetryCount + 1;

                // 减少队列计数（因为当前执行已经失败结束）
                if (workflowRun.machine_id) {
                    await decrementMachineQueue(workflowRun.machine_id);
                    console.log(`[retry] Decremented queue count for machine ${workflowRun.machine_id}`);
                }

                // 清理之前的输出数据（重试时需要重新生成）
                await db
                    .delete(workflowRunOutputs)
                    .where(eq(workflowRunOutputs.run_id, run_id));
                console.log(`[retry] Cleared previous output data for run ${run_id}`);

                // 更新重试计数
                await db
                    .update(workflowRunsTable)
                    .set({
                        retry_count: newRetryCount,
                        // 暂时不更新状态，等重试开始时再更新
                    })
                    .where(eq(workflowRunsTable.id, run_id));

                // 延迟后触发重试
                setTimeout(async () => {
                    try {
                        console.log(`[retry] Starting retry execution for run ${run_id}`);
                        const { createRun } = await import("@/server/createRun");

                        const result = await createRun({
                            origin: process.env.API_URL || "",
                            workflow_version_id: workflowRun.workflow_version_id!,
                            machine_id: workflowRun.machine_id!,
                            inputs: workflowRun.workflow_inputs || undefined,
                            runOrigin: workflowRun.origin,
                            queueJobId: workflowRun.queue_job_id || undefined,
                            existingRunId: run_id,
                            isRetry: true,
                        });

                        console.log(`[retry] Retry initiated for run ${run_id}:`, result);
                    } catch (retryError) {
                        console.error(`[retry] Failed to retry run ${run_id}:`, retryError);

                        // 重试失败，标记为最终失败
                        await db
                            .update(workflowRunsTable)
                            .set({
                                status: "failed",
                                ended_at: new Date(),
                            })
                            .where(eq(workflowRunsTable.id, run_id));

                        // 发送最终失败通知
                        try {
                            const { sendWebhookNotification, buildWebhookPayload } = await import("@/server/notifications/webhook-notifier");
                            const payload = await buildWebhookPayload(
                                run_id,
                                "failed",
                                `Workflow execution failed after ${newRetryCount} retries`
                            );
                            await sendWebhookNotification(payload);
                        } catch (notifyError) {
                            console.error(`[retry] Failed to send failure notification:`, notifyError);
                        }
                    }
                }, RETRY_DELAY_MS);

                // 返回，不继续执行后续的状态更新和通知逻辑
                console.log(`[retry] Retry scheduled in ${RETRY_DELAY_MS}ms for run ${run_id}`);
                return;
            } else {
                // 不满足重试条件，记录原因
                if (maxRetries === 0) {
                    console.log(`[retry] Retry not enabled for run ${run_id} (max_retries=0)`);
                } else if (currentRetryCount >= maxRetries) {
                    console.log(`[retry] Max retries reached for run ${run_id} (${currentRetryCount}/${maxRetries})`);
                } else if (!shouldRetryError(output_data)) {
                    console.log(`[retry] Error type not retryable for run ${run_id}`);
                }
            }
        }

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

            // 【事件驱动调度】Machine 空闲了，尝试处理下一个等待的任务
            // 这样可以保证 FIFO 顺序，不会有"新任务插队"的问题
            try {
                const { tryProcessNextJob } = await import("@/server/queue/event-driven-scheduler");
                // 异步处理，不阻塞当前请求
                tryProcessNextJob(workflowRun.machine_id).catch(err => {
                    console.error(`[Scheduler] Error processing next job:`, err);
                });
            } catch (schedulerError) {
                console.error(`[Scheduler] Failed to import scheduler:`, schedulerError);
            }

            // 发送异步通知（webhook）
            // 对于失败的任务，在这里发送通知表示是最终失败（没有重试或重试次数已用完）
            try {
                const { sendWebhookNotification, buildWebhookPayload } = await import("@/server/notifications/webhook-notifier");

                // 如果是失败且有重试历史，在消息中说明
                let errorMessage = status === "failed" ? "Workflow execution failed" : undefined;
                if (status === "failed" && workflowRun.retry_count > 0) {
                    errorMessage = `Workflow execution failed after ${workflowRun.retry_count} retries`;
                }

                const payload = await buildWebhookPayload(
                    run_id,
                    status,
                    errorMessage
                );
                // 异步发送，不阻塞主流程
                sendWebhookNotification(payload).catch(err => {
                    console.error(`[Webhook] Failed to send notification for run ${run_id}:`, err);
                });
            } catch (error) {
                console.error(`[Webhook] Error setting up notification for run ${run_id}:`, error);
                // 不抛出错误，避免影响主流程
            }
        }
    }
}

