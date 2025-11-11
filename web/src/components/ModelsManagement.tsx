"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, Trash2, FileIcon, Send, History } from "lucide-react";
import { toast } from "sonner";
import { getModels, deleteModel, generateDownloadUrl } from "@/app/(app)/models/actions";
import { ModelPushDialog } from "@/components/ModelPushDialog";
import Link from "next/link";

interface Model {
  id: string;
  filename: string;
  folder_path: string;
  file_size: number | null;
  created_at: Date;
  s3_object_key: string;
}

export function ModelsManagement() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);

  useEffect(() => {
    fetchModels();
  }, []);

  const fetchModels = async () => {
    try {
      setLoading(true);
      const data = await getModels();
      setModels(data);
    } catch (error) {
      console.error("Error fetching models:", error);
      toast.error("加载模型列表失败");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (modelId: string) => {
    if (!confirm("确定要删除这个模型吗？这将同时删除 S3 上的文件。")) {
      return;
    }

    try {
      setDeleting(modelId);
      await deleteModel(modelId);
      toast.success("模型删除成功");
      fetchModels(); // Refresh the list
    } catch (error) {
      console.error("Error deleting model:", error);
      toast.error("删除模型失败");
    } finally {
      setDeleting(null);
    }
  };

  const handleDownload = async (model: Model) => {
    try {
      const { downloadUrl } = await generateDownloadUrl(model.s3_object_key);

      // Open download URL in new tab
      window.open(downloadUrl, "_blank");
      toast.success("正在下载模型");
    } catch (error) {
      console.error("Error downloading model:", error);
      toast.error("生成下载链接失败");
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (bytes === null) return "未知";
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) {
      return `${mb.toFixed(2)} MB`;
    }
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleString("zh-CN");
  };

  const toggleSelectModel = (modelId: string) => {
    setSelectedModelIds((prev) =>
      prev.includes(modelId)
        ? prev.filter((id) => id !== modelId)
        : [...prev, modelId]
    );
  };

  const selectAllModels = () => {
    if (selectedModelIds.length === models.length) {
      setSelectedModelIds([]);
    } else {
      setSelectedModelIds(models.map((m) => m.id));
    }
  };

  const handlePushSuccess = () => {
    setSelectedModelIds([]);
    toast.success("推送任务创建成功，请前往任务页面查看进度");
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">加载中...</div>
        </CardContent>
      </Card>
    );
  }

  if (models.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            <FileIcon className="mx-auto h-12 w-12 mb-4" />
            <p>还没有上传任何模型</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>模型列表</CardTitle>
            <CardDescription>
              共 {models.length} 个模型
              {selectedModelIds.length > 0 && ` · 已选择 ${selectedModelIds.length} 个`}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/models/push">
                <History className="h-4 w-4 mr-2" />
                推送任务
              </Link>
            </Button>
            <ModelPushDialog
              selectedModelIds={selectedModelIds}
              onSuccess={handlePushSuccess}
              trigger={
                <Button disabled={selectedModelIds.length === 0}>
                  <Send className="h-4 w-4 mr-2" />
                  推送到机器 ({selectedModelIds.length})
                </Button>
              }
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">
                <Checkbox
                  checked={
                    selectedModelIds.length === models.length &&
                    models.length > 0
                  }
                  onCheckedChange={selectAllModels}
                  aria-label="全选"
                />
              </TableHead>
              <TableHead>文件名</TableHead>
              <TableHead>路径</TableHead>
              <TableHead>大小</TableHead>
              <TableHead>上传时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((model) => (
              <TableRow
                key={model.id}
                className={
                  selectedModelIds.includes(model.id)
                    ? "bg-muted/50"
                    : ""
                }
              >
                <TableCell>
                  <Checkbox
                    checked={selectedModelIds.includes(model.id)}
                    onCheckedChange={() => toggleSelectModel(model.id)}
                    aria-label={`选择 ${model.filename}`}
                  />
                </TableCell>
                <TableCell className="font-medium">{model.filename}</TableCell>
                <TableCell className="text-muted-foreground">
                  {model.folder_path}
                </TableCell>
                <TableCell>{formatFileSize(model.file_size)}</TableCell>
                <TableCell>{formatDate(model.created_at)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownload(model)}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      下载
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(model.id)}
                      disabled={deleting === model.id}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      {deleting === model.id ? "删除中..." : "删除"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

