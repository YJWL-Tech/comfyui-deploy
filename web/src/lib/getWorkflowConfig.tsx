import type { getWorkflowVersionFromVersionIndex } from "../components/VersionSelect";
import { getInputsFromWorkflow } from "./getInputsFromWorkflow";
import { getOutputsFromWorkflow } from "./getOutputsFromWorkflow";

/**
 * 从workflow version中提取inputs和outputs配置
 */
export function getWorkflowConfig(
  workflow_version: ReturnType<typeof getWorkflowVersionFromVersionIndex>
) {
  if (!workflow_version) return null;
  
  const inputs = getInputsFromWorkflow(workflow_version);
  const outputs = getOutputsFromWorkflow(workflow_version);
  
  return {
    inputs: inputs || [],
    outputs: outputs || [],
  };
}

export type WorkflowConfig = ReturnType<typeof getWorkflowConfig>;

