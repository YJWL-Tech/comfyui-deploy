import type { getWorkflowVersionFromVersionIndex } from "../components/VersionSelect";
import { customOutputNodes } from "@/components/customOutputNodes";

export function getOutputsFromWorkflow(
  workflow_version: ReturnType<typeof getWorkflowVersionFromVersionIndex>
) {
  if (!workflow_version || !workflow_version.workflow_api) return null;
  return Object.entries(workflow_version.workflow_api)
    .map(([_, value]) => {
      if (!value.class_type) return undefined;
      const nodeType = customOutputNodes[value.class_type];
      if (nodeType) {
        const output_id = value.inputs.output_id as string;
        return {
          class_type: value.class_type,
          output_id,
          type: nodeType,
        };
      }
      return undefined;
    })
    .filter((item) => item !== undefined);
}

