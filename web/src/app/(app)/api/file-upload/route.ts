import { handleResourceUpload } from "@/server/resource";
import { getFileDownloadUrl } from "@/server/getFileDownloadUrl";
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseDataSafe } from "../../../../lib/parseDataSafe";

const Request = z.object({
  file_name: z.string(),
  run_id: z.string(),

  type: z.string(),
});

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const [data, error] = await parseDataSafe(Request, request);
  if (!data || error) return error;

  const { file_name, run_id, type } = data;

  try {
    const resourceId = `outputs/runs/${run_id}/${file_name}`;

    const uploadUrl = await handleResourceUpload({
      resourceBucket: process.env.SPACES_BUCKET,
      resourceId: resourceId,
      resourceType: type,
      isPublic: true,
    });

    // Generate download URL for the uploaded file
    const downloadUrl = await getFileDownloadUrl(resourceId);

    return NextResponse.json(
      {
        url: uploadUrl,
        download_url: downloadUrl,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: errorMessage,
      },
      { status: 500 },
    );
  }
}
