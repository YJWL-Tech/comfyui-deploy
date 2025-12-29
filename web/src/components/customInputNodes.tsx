export const customInputNodes: Record<string, string> = {
  ComfyUIDeployExternalText: "string",
  ComfyUIDeployExternalImage: "string - (public image url)",
  ComfyUIDeployExternalImageAlpha: "string - (public image url)",
  ComfyUIDeployExternalImageBatch: "string - (JSON array of image urls)",
  // Number inputs
  ComfyUIDeployExternalNumber: "float",
  ComfyUIDeployExternalNumberInt: "integer",
  ComfyUIDeployExternalLora: "string - (public lora download url)",
  ComfyUIDeployExternalCheckpoint: "string - (public checkpoints download url)",
  ComfyUIDeployExternalFaceModel: "string - (public face model download url)",
};
