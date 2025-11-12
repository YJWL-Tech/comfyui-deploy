"use client";

import { LoadingIcon } from "@/components/LoadingIcon";
import AutoForm, { AutoFormSubmit } from "@/components/ui/auto-form";
import { Badge } from "@/components/ui/badge";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { showcaseMediaNullable, workflowAPINodeType } from "@/db/schema";
import { checkStatus, createRun } from "@/server/createRun";
import { createDeployments } from "@/server/curdDeploments";
import type { getMachines } from "@/server/curdMachine";
import type { findFirstTableWithVersion } from "@/server/findFirstTableWithVersion";
import { getMachineGroups } from "@/server/curdMachineGroup";
import {
  Copy,
  Edit,
  ExternalLink,
  Info,
  MoreVertical,
  Play,
} from "lucide-react";
import { parseAsInteger, useQueryState } from "next-usequerystate";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import type { z } from "zod";
import { create } from "zustand";
import { workflowVersionInputsToZod } from "../lib/workflowVersionInputsToZod";
import { callServerPromise } from "./callServerPromise";
import fetcher from "./fetcher";
import { ButtonAction } from "@/components/ButtonActionLoader";
import { editWorkflowOnMachine } from "@/server/editWorkflowOnMachine";
import { VisualizeImagesGrid } from "@/components/VisualizeImagesGrid";

export function VersionSelect({
  workflow,
}: {
  workflow: Awaited<ReturnType<typeof findFirstTableWithVersion>>;
}) {
  const [version, setVersion] = useQueryState("version", {
    defaultValue: workflow?.versions[0].version?.toString() ?? "",
  });
  return (
    <Select
      value={version}
      onValueChange={(v) => {
        setVersion(v);
      }}
    >
      <SelectTrigger className="w-[100px]">
        <SelectValue placeholder="Select a version" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Versions</SelectLabel>
          {workflow?.versions.map((x) => (
            <SelectItem key={x.id} value={x.version?.toString() ?? ""}>
              {x.version}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function MachineSelect({
  machines,
}: {
  machines: Awaited<ReturnType<typeof getMachines>>;
}) {
  const [machine, setMachine] = useSelectedMachine(machines);

  return (
    <Select
      value={machine}
      onValueChange={(v) => {
        setMachine(v);
      }}
    >
      <SelectTrigger className="w-[180px] text-start">
        <SelectValue placeholder="Select a machine" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Machines</SelectLabel>
          {machines?.map((x) => (
            <SelectItem key={x.id} value={x.id ?? ""}>
              {x.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

type SelectedMachineStore = {
  selectedMachine: string | undefined;
  setSelectedMachine: (machine: string) => void;
};

export const selectedMachineStore = create<SelectedMachineStore>((set) => ({
  selectedMachine: undefined,
  setSelectedMachine: (machine) => set(() => ({ selectedMachine: machine })),
}));

export function useSelectedMachine(
  machines: Awaited<ReturnType<typeof getMachines>>,
): [string, (v: string) => void] {
  const { selectedMachine, setSelectedMachine } = selectedMachineStore();
  return [selectedMachine ?? machines?.[0]?.id ?? "", setSelectedMachine];

  // const searchParams = useSearchParams();
  // const pathname = usePathname();
  // const router = useRouter();

  // const createQueryString = useCallback(
  //   (name: string, value: string) => {
  //     const params = new URLSearchParams(searchParams.toString());
  //     params.set(name, value);

  //     return params.toString();
  //   },
  //   [searchParams],
  // );

  // return [
  //   searchParams.get("machine") ?? machines?.[0]?.id ?? "",
  //   (v: string) => {
  //     // window.history.pushState(
  //     //   "new url",
  //     //   "",
  //     //   pathname + "?" + createQueryString("machine", v),
  //     // );
  //     // router.push(pathname + "?" + createQueryString("machine", v));
  //     router.replace(pathname + "?" + createQueryString("machine", v));
  //   },
  // ];
}

type PublicRunStore = {
  image: {
    url: string;
  }[] | null;
  loading: boolean;
  runId: string;
  status: string;

  setImage: (image: { url: string; }[]) => void;
  setLoading: (loading: boolean) => void;
  setRunId: (runId: string) => void;
  setStatus: (status: string) => void;
};

export const publicRunStore = create<PublicRunStore>((set) => ({
  image: null,
  loading: false,
  runId: "",
  status: "",

  setImage: (image) => set({ image }),
  setLoading: (loading) => set({ loading }),
  setRunId: (runId) => set({ runId }),
  setStatus: (status) => set({ status }),
}));

export function PublicRunOutputs(props: {
  preview: z.infer<typeof showcaseMediaNullable>;
}) {
  const { image, loading, runId, status, setStatus, setImage, setLoading } =
    publicRunStore();

  useEffect(() => {
    if (!runId) return;
    const interval = setInterval(() => {
      checkStatus(runId).then((res) => {
        console.log(res?.status);
        if (res) setStatus(res.status);
        if (res && res.status === "success") {
          // 安全检查：确保 outputs 和 images 存在
          const images = res.outputs?.[0]?.data?.images;
          if (images && Array.isArray(images)) {
            const imageURLs = images.map((item: { url: string; }) => {
              return { url: item.url };
            });
            setImage(imageURLs);
          } else {
            console.warn("No images found in outputs:", res.outputs);
            setImage([]);
          }
          setLoading(false);
          clearInterval(interval);
        }
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [runId]);

  if (loading) {
    return (
      <div className="border border-gray-200 w-full h-[400px] square rounded-lg relative p-4 ">
        <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center gap-2">
          {status} <LoadingIcon />
        </div>
        <Skeleton className="w-full h-full" />
      </div>
    );
  }

  return (
    <div className="border border-gray-200 w-full min-h-[400px] square rounded-lg relative p-4 ">
      {!image && props.preview && props.preview.length > 0 &&
        <VisualizeImagesGrid images={props.preview} />
      }
      {image && (
        <VisualizeImagesGrid images={image} />
      )}
    </div>
  );
}

export function RunWorkflowButton({
  workflow,
  machines,
}: {
  workflow: Awaited<ReturnType<typeof findFirstTableWithVersion>>;
  machines: Awaited<ReturnType<typeof getMachines>>;
}) {
  const [version] = useQueryState("version", {
    defaultValue: workflow?.versions[0].version ?? 1,
    ...parseAsInteger,
  });
  const [machine] = useSelectedMachine(machines);
  const [isLoading, setIsLoading] = useState(false);

  const [values, setValues] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);

  const schema = useMemo(() => {
    const workflow_version = getWorkflowVersionFromVersionIndex(
      workflow,
      version,
    );

    if (!workflow_version) return null;

    return workflowVersionInputsToZod(workflow_version);
  }, [version]);

  const runWorkflow = async () => {
    console.log(values);

    const val = Object.keys(values).length > 0 ? values : undefined;

    const workflow_version_id = workflow?.versions.find(
      (x) => x.version === version,
    )?.id;
    console.log(workflow_version_id);
    if (!workflow_version_id) return;

    setIsLoading(true);
    try {
      const origin = window.location.origin;
      await callServerPromise(
        createRun({
          origin,
          workflow_version_id,
          machine_id: machine,
          inputs: val,
          runOrigin: "manual",
        }),
      );
      // console.log(res.json());
      setIsLoading(false);
    } catch (error) {
      setIsLoading(false);
    }

    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild className="appearance-none hover:cursor-pointer">
        <Button className="gap-2" disabled={isLoading}>
          Run {isLoading ? <LoadingIcon /> : <Play size={14} />}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Confirm run</DialogTitle>
          <DialogDescription>
            {schema
              ? "Run your workflow with custom inputs"
              : "Confirm to run your workflow"}
          </DialogDescription>
        </DialogHeader>
        {/* <div className="max-h-96 overflow-y-scroll"> */}
        {schema && (
          <AutoForm
            formSchema={schema}
            values={values}
            onValuesChange={setValues}
            onSubmit={runWorkflow}
            className="px-1"
          >
            <div className="flex justify-end">
              <AutoFormSubmit disabled={isLoading}>
                Run
                {isLoading ? <LoadingIcon /> : <Play size={14} />}
              </AutoFormSubmit>
            </div>
          </AutoForm>
        )}
        {!schema && (
          <Button className="gap-2" disabled={isLoading} onClick={runWorkflow}>
            Confirm {isLoading ? <LoadingIcon /> : <Play size={14} />}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CreateDeploymentButton({
  workflow,
  machines,
  machineGroups,
}: {
  workflow: Awaited<ReturnType<typeof findFirstTableWithVersion>>;
  machines: Awaited<ReturnType<typeof getMachines>>;
  machineGroups?: Awaited<ReturnType<typeof getMachineGroups>>;
}) {
  const [version] = useQueryState("version", {
    defaultValue: workflow?.versions[0].version ?? 1,
    ...parseAsInteger,
  });
  const [machine] = useSelectedMachine(machines);
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [useGroup, setUseGroup] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const workflow_version_id = workflow?.versions.find(
    (x) => x.version === version,
  )?.id;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2" disabled={isLoading} variant="outline">
          Deploy {isLoading ? <LoadingIcon /> : <MoreVertical size={14} />}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Deployment</DialogTitle>
          <DialogDescription>
            Choose machine or machine group for deployment
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="flex items-center space-x-2">
              <input
                type="radio"
                checked={!useGroup}
                onChange={() => setUseGroup(false)}
              />
              <span>Use Single Machine</span>
            </label>
            {!useGroup && (
              <MachineSelect machines={machines} />
            )}
          </div>
          {machineGroups && machineGroups.length > 0 && (
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  checked={useGroup}
                  onChange={() => setUseGroup(true)}
                />
                <span>Use Machine Group</span>
              </label>
              {useGroup && (
                <Select
                  value={selectedGroup}
                  onValueChange={setSelectedGroup}
                  className="mt-2"
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a machine group" />
                  </SelectTrigger>
                  <SelectContent>
                    {machineGroups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name} ({g.members.length} machines)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              onClick={async () => {
                if (!workflow_version_id) return;
                if (useGroup && !selectedGroup) return;
                if (!useGroup && !machine) return;

                setIsLoading(true);
                try {
                  await callServerPromise(
                    createDeployments(
                      workflow.id,
                      workflow_version_id,
                      useGroup ? null : machine,
                      useGroup ? selectedGroup : null,
                      "production",
                    ),
                  );
                  setOpen(false);
                } finally {
                  setIsLoading(false);
                }
              }}
              disabled={isLoading || (useGroup ? !selectedGroup : !machine)}
            >
              Deploy to Production
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (!workflow_version_id) return;
                if (!machine) return; // Staging只能使用machine

                setIsLoading(true);
                try {
                  await callServerPromise(
                    createDeployments(
                      workflow.id,
                      workflow_version_id,
                      machine,
                      null,
                      "staging",
                    ),
                  );
                  setOpen(false);
                } finally {
                  setIsLoading(false);
                }
              }}
              disabled={isLoading || !machine}
            >
              Deploy to Staging
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function OpenEditButton({
  workflow,
  machines,
}: {
  workflow: Awaited<ReturnType<typeof findFirstTableWithVersion>>;
  machines: Awaited<ReturnType<typeof getMachines>>;
}) {
  const [version] = useQueryState("version", {
    defaultValue: workflow?.versions[0].version ?? 1,
    ...parseAsInteger,
  });
  const [machine] = useSelectedMachine(machines);
  const workflow_version_id = workflow?.versions.find(
    (x) => x.version == version,
  )?.id;
  const [isLoading, setIsLoading] = useState(false);

  return (
    workflow_version_id &&
    machine && (
      <Button
        className="gap-2"
        onClick={async () => {
          setIsLoading(true);
          const url = await callServerPromise(
            editWorkflowOnMachine(workflow_version_id, machine),
          );
          if (url && typeof url !== "object") {
            window.open(url, "_blank");
          } else if (url && typeof url === "object" && url.error) {
            console.error(url.error);
          }
          setIsLoading(false);
        }}
        // asChild
        variant="outline"
      >
        Edit {isLoading ? <LoadingIcon /> : <Edit size={14} />}
      </Button>
    )
  );
}

export function CopyWorkflowVersion({
  workflow,
}: {
  workflow: Awaited<ReturnType<typeof findFirstTableWithVersion>>;
}) {
  const [version] = useQueryState("version", {
    defaultValue: workflow?.versions[0].version ?? 1,
    ...parseAsInteger,
  });
  const workflow_version = workflow?.versions.find(
    (x) => x.version === version,
  );
  const [showDialog, setShowDialog] = useState(false);
  const [dialogText, setDialogText] = useState("");
  const [dialogTitle, setDialogTitle] = useState("");

  return (
    <>
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              内容已显示在下方，您可以全选并复制（Ctrl+A, Ctrl+C）
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <textarea
              readOnly
              value={dialogText}
              className="w-full h-[60vh] p-4 font-mono text-sm bg-gray-50 dark:bg-gray-900 border rounded-md resize-none"
              onClick={(e) => {
                (e.target as HTMLTextAreaElement).select();
              }}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  const textarea = document.querySelector(
                    'textarea[readonly]',
                  ) as HTMLTextAreaElement;
                  if (textarea) {
                    textarea.select();
                    document.execCommand("copy");
                    toast.success("已复制到剪贴板");
                  }
                }}
              >
                <Copy size={14} className="mr-2" />
                复制
              </Button>
              <Button onClick={() => setShowDialog(false)}>关闭</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="gap-2" variant="outline">
            Copy Workflow <Copy size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuItem
            onClick={async () => {
              if (!workflow) {
                toast.error("Workflow not found");
                return;
              }

              if (!workflow_version) {
                toast.error("Workflow version not found");
                return;
              }

              if (!workflow_version.workflow) {
                toast.error("Workflow data is empty");
                console.error("workflow_version.workflow is null or undefined:", workflow_version);
                return;
              }

              // 创建副本以避免修改原始数据
              const workflowCopy = JSON.parse(JSON.stringify(workflow_version.workflow));

              // 更新 ComfyDeploy 节点
              if (workflowCopy?.nodes) {
                workflowCopy.nodes.forEach((x: any) => {
                  if (x?.type === "ComfyDeploy") {
                    x.widgets_values[1] = workflow.id;
                    x.widgets_values[2] = workflow_version.version;
                  }
                });
              }

              const text = JSON.stringify(workflowCopy, null, 2);

              console.log("Copying workflow, length:", text.length);
              console.log("Workflow preview:", text.substring(0, 200));

              if (!text || text === "null" || text === "undefined" || text.length === 0) {
                toast.error("Workflow data is empty, cannot copy");
                console.error("Text to copy is empty:", { text, workflow: workflow_version.workflow });
                return;
              }

              // 使用更可靠的复制方法
              const copyToClipboard = async (textToCopy: string) => {
                // 确保文本是纯文本，移除任何特殊字符
                const cleanText = textToCopy.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

                // 方法1: 尝试使用 Clipboard API
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  try {
                    // 使用 ClipboardItem 确保纯文本格式
                    const clipboardItem = new ClipboardItem({
                      'text/plain': new Blob([cleanText], { type: 'text/plain' })
                    });
                    await navigator.clipboard.write([clipboardItem]);
                    console.log("Clipboard API copy succeeded with ClipboardItem");
                    return true;
                  } catch (err1) {
                    try {
                      // 如果 ClipboardItem 失败，尝试直接 writeText
                      await navigator.clipboard.writeText(cleanText);
                      console.log("Clipboard API copy succeeded with writeText");
                      return true;
                    } catch (err2) {
                      console.warn("Clipboard API failed, trying fallback:", err2);
                    }
                  }
                }

                // 方法2: 降级方案 - 使用可见的 textarea（更可靠）
                try {
                  const textArea = document.createElement("textarea");
                  textArea.value = cleanText;
                  textArea.style.position = "fixed";
                  textArea.style.top = "0";
                  textArea.style.left = "0";
                  textArea.style.width = "2em";
                  textArea.style.height = "2em";
                  textArea.style.padding = "0";
                  textArea.style.border = "none";
                  textArea.style.outline = "none";
                  textArea.style.boxShadow = "none";
                  textArea.style.background = "transparent";
                  textArea.setAttribute("readonly", "");
                  document.body.appendChild(textArea);

                  textArea.focus();
                  textArea.select();
                  textArea.setSelectionRange(0, cleanText.length);

                  const successful = document.execCommand("copy");
                  document.body.removeChild(textArea);

                  if (successful) {
                    console.log("Fallback copy method succeeded");
                    return true;
                  } else {
                    throw new Error("execCommand('copy') returned false");
                  }
                } catch (err) {
                  console.error("Fallback copy method failed:", err);
                  throw err;
                }
              };

              try {
                const success = await copyToClipboard(text);
                if (success) {
                  toast.success("已复制到剪贴板");
                } else {
                  throw new Error("复制失败");
                }
              } catch (error) {
                console.error("Failed to copy:", error);
                // 如果自动复制失败，显示对话框让用户手动复制
                setDialogTitle("复制 Workflow (JSON)");
                setDialogText(text);
                setShowDialog(true);
                toast.info("自动复制失败，请在弹出的对话框中手动复制");
              }
            }}
          >
            Copy (JSON)
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={async () => {
              if (!workflow_version) {
                toast.error("Workflow version not found");
                return;
              }

              if (!workflow_version.workflow_api) {
                toast.error("Workflow API data is empty");
                console.error("workflow_version.workflow_api is null or undefined:", workflow_version);
                return;
              }

              const text = JSON.stringify(workflow_version.workflow_api, null, 2);

              console.log("Copying workflow API, length:", text.length);
              console.log("Workflow API preview:", text.substring(0, 200));

              if (!text || text === "null" || text === "undefined" || text.length === 0) {
                toast.error("Workflow API data is empty, cannot copy");
                console.error("Text to copy is empty:", { text, workflow_api: workflow_version.workflow_api });
                return;
              }

              // 使用更可靠的复制方法
              const copyToClipboard = async (textToCopy: string) => {
                // 确保文本是纯文本，移除任何特殊字符
                const cleanText = textToCopy.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

                // 方法1: 尝试使用 Clipboard API
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  try {
                    // 使用 ClipboardItem 确保纯文本格式
                    const clipboardItem = new ClipboardItem({
                      'text/plain': new Blob([cleanText], { type: 'text/plain' })
                    });
                    await navigator.clipboard.write([clipboardItem]);
                    console.log("Clipboard API copy succeeded with ClipboardItem");
                    return true;
                  } catch (err1) {
                    try {
                      // 如果 ClipboardItem 失败，尝试直接 writeText
                      await navigator.clipboard.writeText(cleanText);
                      console.log("Clipboard API copy succeeded with writeText");
                      return true;
                    } catch (err2) {
                      console.warn("Clipboard API failed, trying fallback:", err2);
                    }
                  }
                }

                // 方法2: 降级方案 - 使用可见的 textarea（更可靠）
                try {
                  const textArea = document.createElement("textarea");
                  textArea.value = cleanText;
                  textArea.style.position = "fixed";
                  textArea.style.top = "0";
                  textArea.style.left = "0";
                  textArea.style.width = "2em";
                  textArea.style.height = "2em";
                  textArea.style.padding = "0";
                  textArea.style.border = "none";
                  textArea.style.outline = "none";
                  textArea.style.boxShadow = "none";
                  textArea.style.background = "transparent";
                  textArea.setAttribute("readonly", "");
                  document.body.appendChild(textArea);

                  textArea.focus();
                  textArea.select();
                  textArea.setSelectionRange(0, cleanText.length);

                  const successful = document.execCommand("copy");
                  document.body.removeChild(textArea);

                  if (successful) {
                    console.log("Fallback copy method succeeded");
                    return true;
                  } else {
                    throw new Error("execCommand('copy') returned false");
                  }
                } catch (err) {
                  console.error("Fallback copy method failed:", err);
                  throw err;
                }
              };

              try {
                const success = await copyToClipboard(text);
                if (success) {
                  toast.success("已复制到剪贴板");
                } else {
                  throw new Error("复制失败");
                }
              } catch (error) {
                console.error("Failed to copy:", error);
                // 如果自动复制失败，显示对话框让用户手动复制
                setDialogTitle("复制 Workflow API (JSON)");
                setDialogText(text);
                setShowDialog(true);
                toast.info("自动复制失败，请在弹出的对话框中手动复制");
              }
            }}
          >
            Copy API (JSON)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export function getWorkflowVersionFromVersionIndex(
  workflow: Awaited<ReturnType<typeof findFirstTableWithVersion>>,
  version: number,
) {
  const workflow_version = workflow?.versions.find((x) => x.version == version);

  return workflow_version;
}

export function ViewWorkflowDetailsButton({
  workflow,
}: {
  workflow: Awaited<ReturnType<typeof findFirstTableWithVersion>>;
}) {
  const [version] = useQueryState("version", {
    defaultValue: workflow?.versions[0].version ?? 1,
    ...parseAsInteger,
  });
  const [isLoading, setIsLoading] = useState(false);

  const [open, setOpen] = useState(false);

  const {
    data,
    error,
    isLoading: isNodesIndexLoading,
  } = useSWR(
    "https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/extension-node-map.json",
    fetcher,
  );

  const groupedByAuxName = useMemo(() => {
    if (!data) return null;

    // console.log(data);

    const workflow_version = getWorkflowVersionFromVersionIndex(
      workflow,
      version,
    );

    const api = workflow_version?.workflow_api;

    if (!api) return null;

    const crossCheckedApi = Object.entries(api)
      .map(([_, value]) => {
        const classType = value.class_type;
        const classTypeData = Object.entries(data).find(([_, nodeArray]) =>
          nodeArray[0].includes(classType),
        );
        return classTypeData ? { node: value, classTypeData } : null;
      })
      .filter((item) => item !== null);

    // console.log(crossCheckedApi);

    const groupedByAuxName = crossCheckedApi.reduce(
      (acc, data) => {
        if (!data) return acc;

        const { node, classTypeData } = data;
        const auxName = classTypeData[1][1].title_aux;
        // console.log(auxName);
        if (!acc[auxName]) {
          acc[auxName] = {
            url: classTypeData[0],
            node: [],
          };
        }
        acc[auxName].node.push(node);
        return acc;
      },
      {} as Record<
        string,
        {
          node: z.infer<typeof workflowAPINodeType>[];
          url: string;
        }
      >,
    );

    // console.log(groupedByAuxName);

    return groupedByAuxName;
  }, [version, data]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild className="appearance-none hover:cursor-pointer">
        <Button className="gap-2" variant="outline">
          Details <Info size={14} />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Workflow Details</DialogTitle>
          <DialogDescription>
            View your custom nodes, models, external files used in this workflow
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-auto max-h-[400px] w-full">
          <Table>
            <TableHeader className="bg-background top-0 sticky">
              <TableRow>
                <TableHead className="w-[200px]">File</TableHead>
                <TableHead className="">Output</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupedByAuxName &&
                Object.entries(groupedByAuxName).map(([key, group]) => {
                  // const filePath
                  return (
                    <TableRow key={key}>
                      <TableCell className="break-words">
                        <a
                          href={group.url}
                          target="_blank"
                          className="hover:underline"
                          rel="noreferrer"
                        >
                          {key}
                          <ExternalLink
                            className="inline-block ml-1"
                            size={12}
                          />
                        </a>
                      </TableCell>
                      <TableCell className="flex flex-wrap gap-2">
                        {group.node.map((x) => (
                          <Badge key={x.class_type} variant="outline">
                            {x.class_type}
                          </Badge>
                        ))}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </div>

        <div className="flex justify-end">
          <Button className="w-fit" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
        {/* </div> */}
        {/* <div className="max-h-96 overflow-y-scroll">{view}</div> */}
      </DialogContent>
    </Dialog>
  );
}
