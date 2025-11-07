"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createWorkflowAction } from "@/app/(app)/workflows/actions";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Plus } from "lucide-react";

export function UploadWorkflow() {
    const [fileName, setFileName] = React.useState<string>("");
    const [jsonText, setJsonText] = React.useState<string>("");
    const [submitting, setSubmitting] = React.useState(false);
    const [isOpen, setIsOpen] = React.useState(false);
    const router = useRouter();

    const onFile = async (file: File | null) => {
        if (!file) return;
        setFileName(file.name);
        const text = await file.text();
        setJsonText(text);
    };

    const onDrop: React.DragEventHandler<HTMLDivElement> = async (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) await onFile(file);
    };

    return (
        <Card className="mb-6">
            <CardHeader
                className="cursor-pointer"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <Plus className="h-4 w-4" />
                        新建 Workflow
                    </CardTitle>
                    {isOpen ? (
                        <ChevronUp className="h-4 w-4" />
                    ) : (
                        <ChevronDown className="h-4 w-4" />
                    )}
                </div>
            </CardHeader>
            {isOpen && (
                <CardContent>
                    <form
                        action={async (formData) => {
                            try {
                                setSubmitting(true);
                                // ensure json value synced
                                if (jsonText) formData.set("json", jsonText);
                                const res = await createWorkflowAction(formData);
                                router.push(`/workflows/${res.workflow_id}`);
                                router.refresh();
                                // 创建成功后折叠
                                setIsOpen(false);
                                // 重置表单
                                setFileName("");
                                setJsonText("");
                            } finally {
                                setSubmitting(false);
                            }
                        }}
                        className="space-y-4"
                    >
                        <div className="space-y-2">
                            <Label htmlFor="name">Workflow Name</Label>
                            <Input id="name" name="name" required placeholder="Prismatic Creation" />
                        </div>
                        <div
                            className="rounded-md border border-dashed p-6 text-center cursor-pointer bg-muted/30"
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={onDrop}
                        >
                            <input
                                type="file"
                                accept="application/json"
                                className="hidden"
                                id="wf-file"
                                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                            />
                            <label htmlFor="wf-file" className="block">
                                点击选择或拖拽 JSON 文件到此处
                            </label>
                            {fileName && <div className="mt-2 text-sm text-muted-foreground">{fileName}</div>}
                        </div>

                        {/* hidden input to carry JSON text via FormData */}
                        <input type="hidden" name="json" value={jsonText} />

                        <div className="flex gap-2 justify-end">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    setIsOpen(false);
                                    setFileName("");
                                    setJsonText("");
                                }}
                            >
                                取消
                            </Button>
                            <Button type="submit" disabled={submitting || !jsonText}>
                                {submitting ? "创建中..." : "创建"}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            )}
        </Card>
    );
}


