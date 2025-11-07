import { parseDataSafe } from "../../../../lib/parseDataSafe";
import { db } from "@/db/db";
import { workflowRunOutputs, workflowRunsTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { decrementMachineQueue } from "@/server/machine/updateMachineStatus";

const Request = z.object({
  run_id: z.string(),
  status: z
    .enum(["not-started", "running", "uploading", "success", "failed"])
    .optional(),
  output_data: z.any().optional(),
});

export async function POST(request: Request) {
  const [data, error] = await parseDataSafe(Request, request);
  if (!data || error) return error;

  const { run_id, status, output_data } = data;

  // console.log(run_id, status, output_data);

  // Handle output_data and status independently - they can both be present
  if (output_data) {
    await db.insert(workflowRunOutputs).values({
      run_id: run_id,
      data: output_data,
    });
  }

  if (status) {
    // console.log("status", status);
    // 先查询当前状态，以便判断是否需要减少队列计数
    const workflowRun = await db.query.workflowRunsTable.findFirst({
      where: eq(workflowRunsTable.id, run_id),
      columns: {
        machine_id: true,
        status: true,
      },
    });

    const previousStatus = workflowRun?.status;
    const isCompleting =
      (status === "success" || status === "failed") &&
      previousStatus !== "success" &&
      previousStatus !== "failed";

    await db
      .update(workflowRunsTable)
      .set({
        status: status,
        ended_at:
          status === "success" || status === "failed" ? new Date() : null,
      })
      .where(eq(workflowRunsTable.id, run_id));

    // 当任务完成（success或failed）时，减少机器的队列计数
    // 这确保队列计数在任务真正完成时才减少，而不是在worker启动任务时
    // 只在状态首次变为success/failed时减少，避免重复减少
    if (isCompleting && workflowRun?.machine_id) {
      await decrementMachineQueue(workflowRun.machine_id);
    }
  }

  // const workflow_version = await db.query.workflowVersionTable.findFirst({
  //   where: eq(workflowRunsTable.id, workflow_run[0].workflow_version_id),
  // });

  // revalidatePath(`./${workflow_version?.workflow_id}`);

  return NextResponse.json(
    {
      message: "success",
    },
    {
      status: 200,
    }
  );
}
