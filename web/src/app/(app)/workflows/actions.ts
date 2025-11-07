"use server";

import { createWorkflowFromUpload } from "@/server/createNewWorkflow";

export async function createWorkflowAction(formData: FormData) {
    const name = (formData.get("name") as string | null)?.trim();
    const jsonText = formData.get("json") as string | File | null;

    if (!name) {
        throw new Error("Workflow name is required");
    }

    if (jsonText == null) {
        throw new Error("Please upload a JSON file");
    }

    let payload: any;
    if (typeof jsonText === "string") {
        payload = JSON.parse(jsonText);
    } else {
        const text = await jsonText.text();
        payload = JSON.parse(text);
    }

    // Accept either a wrapped payload or raw comfy workflow graph
    const isWrapped =
        payload &&
        ("workflow" in payload ||
            ("workflow_api" in payload || "snapshot" in payload));

    const workflow = isWrapped ? payload.workflow ?? payload : payload;
    const workflow_api = isWrapped ? payload.workflow_api ?? {} : {};
    const snapshot = (isWrapped ? payload.snapshot ?? null : null) as any;

    const result = await createWorkflowFromUpload({
        workflow_name: name,
        workflow,
        workflow_api,
        snapshot,
    });

    return result; // { workflow_id, version }
}


