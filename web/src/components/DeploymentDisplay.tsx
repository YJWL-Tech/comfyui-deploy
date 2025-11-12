"use client";

import { CodeBlock } from "@/components/CodeBlock";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getInputsFromWorkflow } from "@/lib/getInputsFromWorkflow";
import type { findAllDeployments } from "@/server/findAllRuns";
import { DeploymentRow, SharePageDeploymentRow } from "./DeploymentRow";
import { Copy, ExternalLink, Settings, Share2, Code, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import React from "react";
import { EditDeploymentDialog } from "./EditDeploymentDialog";

const curlTemplate = `
curl --request POST \
  --url <URL> \
  --header "Content-Type: application/json" \
  --data "{
  "deployment_id": "<ID>"
}"
`;

const curlTemplate_checkStatus = `
curl --request GET \
  --url "<URL>/api/run?run_id=xxx" \
  --header "Content-Type: application/json"
`;

const jsTemplate = `
const { run_id } = await fetch("<URL>", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + process.env.COMFY_DEPLOY_API_KEY,
  },
  body: JSON.stringify({
    deployment_id: "<ID>",
    inputs: {}
  }),
}).then(response => response.json())
`;

const jsTemplate_checkStatus = `
const run_id = "<RUN_ID>";

const output = fetch("<URL>?run_id=" + run_id, {
  method: "GET",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + process.env.COMFY_DEPLOY_API_KEY,
  },
}).then(response => response.json())
`;

const jsClientSetupTemplate = `
const client = new ComfyDeployClient({
  apiBase: "<URLONLY>",
  apiToken: process.env.COMFY_DEPLOY_API_KEY!,
});
`;

const jsClientSetupTemplateHostedVersion = `
const client = new ComfyDeployClient({
  apiToken: process.env.COMFY_DEPLOY_API_KEY!,
});
`;

const jsClientCreateRunTemplate = `
const { run_id } = await client.run("<ID>", {
  inputs: {}
});
`;

const jsClientCreateRunNoInputsTemplate = `
const { run_id } = await client.run("<ID>");
`;

const clientTemplate_checkStatus = `
const run = await client.getRun(run_id);
`;

const clientTemplate_outputExample = `
// Access outputs from the run
if (run.status === "success" && run.outputs) {
  run.outputs.forEach((output) => {
    // Handle image outputs
    if (output.data?.images) {
      output.data.images.forEach((image: any) => {
        console.log("Image URL:", image.url);
        console.log("Image filename:", image.filename);
      });
    }
    // Handle file outputs
    if (output.data?.files) {
      output.data.files.forEach((file: any) => {
        console.log("File URL:", file.url);
        console.log("File filename:", file.filename);
      });
    }
    // Handle text outputs
    if (output.data?.text) {
      console.log("Text output:", output.data.text);
    }
  });
}
`;

const jsTemplate_outputExample = `
// Access outputs from the response
const runData = await fetch("<URL>?run_id=" + run_id, {
  method: "GET",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + process.env.COMFY_DEPLOY_API_KEY,
  },
}).then(response => response.json());

if (runData.status === "success" && runData.outputs) {
  runData.outputs.forEach((outputItem) => {
    // Handle image outputs
    if (outputItem.data?.images) {
      outputItem.data.images.forEach((image) => {
        console.log("Image URL:", image.url);
        console.log("Image filename:", image.filename);
      });
    }
    // Handle file outputs
    if (outputItem.data?.files) {
      outputItem.data.files.forEach((file) => {
        console.log("File URL:", file.url);
        console.log("File filename:", file.filename);
      });
    }
    // Handle text outputs
    if (outputItem.data?.text) {
      console.log("Text output:", outputItem.data.text);
    }
  });
}
`;

const curlTemplate_outputExample = `
# The response will contain outputs array with CDN URLs
# Example response structure:
# {
#   "status": "success",
#   "outputs": [
#     {
#       "data": {
#         "images": [
#           {
#             "url": "https://cdn.example.com/bucket/outputs/runs/{run_id}/{filename}",
#             "filename": "image_001.png"
#           }
#         ],
#         "files": [{"url": "...", "filename": "..."}],
#         "text": "..."
#       }
#     }
#   ]
# }

# The image.url is a public CDN URL that can be:
# 1. Used directly in HTML: <img src="{image.url}" />
# 2. Referenced in markdown: ![alt]({image.url})
# 3. Embedded in other applications
# 4. Shared via direct link

# Example: Get the image URL
IMAGE_URL=$(curl -X GET "<URL>?run_id={run_id}" \\
  -H "Authorization: Bearer $COMFY_DEPLOY_API_KEY" \\
  | jq -r '.outputs[0].data.images[0].url')

echo "Image URL: $IMAGE_URL"
# Use the URL in your application
`;

function SharePageDeploymentButton({
  deployment,
  domain,
  machines,
  machineGroups,
}: {
  deployment: Awaited<ReturnType<typeof findAllDeployments>>[0];
  domain: string;
  machines: any;
  machineGroups: any;
}) {
  const router = useRouter();
  const shareUrl = `${domain}/share/${deployment.share_slug ?? deployment.id}`;
  const [showEditDialog, setShowEditDialog] = React.useState(false);

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareUrl);
    toast.success("分享链接已复制");
  };

  const openSharePage = () => {
    window.open(shareUrl, "_blank");
  };

  const openSettings = () => {
    router.push(`/share/${deployment.share_slug ?? deployment.id}/settings`);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <Share2 size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={copyShareLink}>
            <Copy size={14} className="mr-2" />
            复制链接
          </DropdownMenuItem>
          <DropdownMenuItem onClick={openSharePage}>
            <ExternalLink size={14} className="mr-2" />
            查看分享页
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
            <Settings size={14} className="mr-2" />
            编辑部署
          </DropdownMenuItem>
          <DropdownMenuItem onClick={openSettings}>
            <Pencil size={14} className="mr-2" />
            共享设置
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditDeploymentDialog
        deployment={deployment}
        machines={machines}
        machineGroups={machineGroups}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
      />
    </>
  );
}

function DeploymentActionsButton({
  deployment,
  domain,
  machines,
  machineGroups,
}: {
  deployment: Awaited<ReturnType<typeof findAllDeployments>>[0];
  domain: string;
  machines: any;
  machineGroups: any;
}) {
  const [showCodeDialog, setShowCodeDialog] = React.useState(false);
  const [showEditDialog, setShowEditDialog] = React.useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <Settings size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setShowCodeDialog(true)}>
            <Code size={14} className="mr-2" />
            查看代码
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
            <Pencil size={14} className="mr-2" />
            编辑部署
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeploymentCodeDialog
        deployment={deployment}
        domain={domain}
        open={showCodeDialog}
        onOpenChange={setShowCodeDialog}
      />

      <EditDeploymentDialog
        deployment={deployment}
        machines={machines}
        machineGroups={machineGroups}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
      />
    </>
  );
}

function DeploymentCodeDialog({
  deployment,
  domain,
  open,
  onOpenChange,
}: {
  deployment: Awaited<ReturnType<typeof findAllDeployments>>[0];
  domain: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const workflowInput = getInputsFromWorkflow(deployment.version);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <span />
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="capitalize">
            {deployment.environment} Deployment
          </DialogTitle>
          <DialogDescription>Code for your deployment client</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[600px] pr-4">
          <Tabs defaultValue="client" className="w-full gap-2 text-sm">
            <TabsList className="grid w-fit grid-cols-3 mb-2">
              <TabsTrigger value="client">Server Client</TabsTrigger>
              <TabsTrigger value="js">NodeJS Fetch</TabsTrigger>
              <TabsTrigger value="curl">CURL</TabsTrigger>
            </TabsList>
            <TabsContent className="flex flex-col gap-2 !mt-0" value="client">
              <div>
                Copy and paste the ComfyDeployClient form&nbsp;
                <a
                  href="https://github.com/BennyKok/comfyui-deploy-next-example/blob/main/src/lib/comfy-deploy.ts"
                  className="text-blue-500 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  here
                </a>
              </div>
              <CodeBlock
                lang="js"
                code={formatCode(
                  domain == "https://www.comfydeploy.com"
                    ? jsClientSetupTemplateHostedVersion
                    : jsClientSetupTemplate,
                  deployment,
                  domain,
                  workflowInput,
                )}
              />
              Create a run via deployment id
              <CodeBlock
                lang="js"
                code={formatCode(
                  workflowInput && workflowInput.length > 0
                    ? jsClientCreateRunTemplate
                    : jsClientCreateRunNoInputsTemplate,
                  deployment,
                  domain,
                  workflowInput,
                )}
              />
              Check the status of the run, and retrieve the outputs
              <CodeBlock
                lang="js"
                code={formatCode(
                  clientTemplate_checkStatus,
                  deployment,
                  domain,
                )}
              />
              Access outputs from the run
              <CodeBlock
                lang="js"
                code={formatCode(
                  clientTemplate_outputExample,
                  deployment,
                  domain,
                )}
              />
            </TabsContent>
            <TabsContent className="flex flex-col gap-2 !mt-0" value="js">
              Trigger the workflow
              <CodeBlock
                lang="js"
                code={formatCode(jsTemplate, deployment, domain, workflowInput)}
              />
              Check the status of the run, and retrieve the outputs
              <CodeBlock
                lang="js"
                code={formatCode(jsTemplate_checkStatus, deployment, domain)}
              />
              Access outputs from the response
              <CodeBlock
                lang="js"
                code={formatCode(jsTemplate_outputExample, deployment, domain)}
              />
            </TabsContent>
            <TabsContent className="flex flex-col gap-2 !mt-2" value="curl">
              <CodeBlock
                lang="bash"
                code={formatCode(curlTemplate, deployment, domain)}
              />
              <CodeBlock
                lang="bash"
                code={formatCode(curlTemplate_checkStatus, deployment, domain)}
              />
              Output structure example
              <CodeBlock
                lang="bash"
                code={formatCode(curlTemplate_outputExample, deployment, domain)}
              />
            </TabsContent>
          </Tabs>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function formatCode(
  codeTemplate: string,
  deployment: Awaited<ReturnType<typeof findAllDeployments>>[0],
  domain: string,
  inputs?: ReturnType<typeof getInputsFromWorkflow>,
  inputsTabs?: number,
) {
  if (inputs && inputs.length > 0) {
    codeTemplate = codeTemplate.replace(
      "inputs: {}",
      `inputs: ${JSON.stringify(
        Object.fromEntries(
          inputs.map((x) => {
            return [x?.input_id, ""];
          }),
        ),
        null,
        2,
      )
        .split("\n")
        .map((line, index) => (index === 0 ? line : `    ${line}`)) // Add two spaces indentation except for the first line
        .join("\n")}`,
    );
  } else {
    codeTemplate = codeTemplate.replace(
      `
    inputs: {}`,
      "",
    );
  }
  return codeTemplate
    .replace("<URL>", `${domain ?? "http://localhost:3000"}/api/run`)
    .replace("<ID>", deployment.id)
    .replace("<URLONLY>", domain ?? "http://localhost:3000");
}

export function DeploymentDisplay({
  deployment,
  domain,
  machines,
  machineGroups,
}: {
  deployment: Awaited<ReturnType<typeof findAllDeployments>>[0];
  domain: string;
  machines?: any;
  machineGroups?: any;
}) {
  if (deployment.environment === "public-share") {
    return <SharePageDeploymentButton deployment={deployment} domain={domain} machines={machines || []} machineGroups={machineGroups || []} />;
  }

  if (machines && machineGroups) {
    return <DeploymentActionsButton deployment={deployment} domain={domain} machines={machines} machineGroups={machineGroups} />;
  }

  return <DeploymentActionsButton deployment={deployment} domain={domain} machines={[]} machineGroups={[]} />;
}
