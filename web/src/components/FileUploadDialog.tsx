"use client";

import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { Upload, X, File, Check } from "lucide-react";
import { toast } from "sonner";

interface FileUploadDialogProps {
  currentPath: string;
  onUploadComplete: () => void;
  apiKey: string;
  mode: "personal" | "shared";
  trigger: React.ReactNode;
}

interface UploadFile {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
}

export function FileUploadDialog({
  currentPath,
  onUploadComplete,
  apiKey,
  mode,
  trigger,
}: FileUploadDialogProps) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const uploadFiles = selectedFiles.map((file) => ({
      file,
      progress: 0,
      status: "pending" as const,
    }));
    setFiles((prev) => [...prev, ...uploadFiles]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadFile = async (uploadFile: UploadFile, index: number) => {
    try {
      if (!apiKey) {
        throw new Error("API密钥未加载");
      }

      // Update status to uploading
      setFiles((prev) =>
        prev.map((f, i) =>
          i === index ? { ...f, status: "uploading" as const } : f
        )
      );

      // Get upload URL
      const fileKey = currentPath
        ? `${currentPath}/${uploadFile.file.name}`
        : uploadFile.file.name;

      const urlResponse = await fetch("/api/files/generate-upload-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          key: fileKey,
          contentType: uploadFile.file.type || "application/octet-stream",
          mode,
        }),
      });

      if (!urlResponse.ok) {
        throw new Error("获取上传URL失败");
      }

      const { uploadUrl } = await urlResponse.json();

      // Upload file with progress tracking
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          setFiles((prev) =>
            prev.map((f, i) => (i === index ? { ...f, progress } : f))
          );
        }
      });

      xhr.addEventListener("load", () => {
        // S3 PUT request returns 200 or 204 on success
        if (xhr.status >= 200 && xhr.status < 300) {
          setFiles((prev) =>
            prev.map((f, i) =>
              i === index
                ? { ...f, status: "success" as const, progress: 100 }
                : f
            )
          );
        } else {
          console.error(`Upload failed with status ${xhr.status}`);
          setFiles((prev) =>
            prev.map((f, i) =>
              i === index
                ? { ...f, status: "error" as const, error: `上传失败 (状态码: ${xhr.status})` }
                : f
            )
          );
        }
      });

      xhr.addEventListener("error", () => {
        setFiles((prev) =>
          prev.map((f, i) =>
            i === index
              ? { ...f, status: "error" as const, error: "上传失败" }
              : f
          )
        );
      });

      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", uploadFile.file.type || "application/octet-stream");
      xhr.send(uploadFile.file);
    } catch (error) {
      console.error("Error uploading file:", error);
      setFiles((prev) =>
        prev.map((f, i) =>
          i === index
            ? {
                ...f,
                status: "error" as const,
                error: error instanceof Error ? error.message : "上传失败",
              }
            : f
        )
      );
    }
  };

  const handleUploadAll = async () => {
    setUploading(true);
    try {
      // Upload all files in parallel
      await Promise.all(
        files.map((file, index) => {
          if (file.status === "pending") {
            return uploadFile(file, index);
          }
          return Promise.resolve();
        })
      );

      // Check if all uploads succeeded
      const allSuccess = files.every((f) => f.status === "success");
      if (allSuccess) {
        toast.success("所有文件上传成功");
        onUploadComplete();
        setOpen(false);
        setFiles([]);
      } else {
        toast.error("部分文件上传失败");
      }
    } catch (error) {
      console.error("Error uploading files:", error);
      toast.error("上传失败");
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>上传文件</DialogTitle>
          <DialogDescription>
            上传文件到 {currentPath || "根目录"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          <div className="space-y-4 py-4">
            {/* File input */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full"
              >
                <Upload className="w-4 h-4 mr-2" />
                选择文件
              </Button>
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((uploadFile, index) => (
                  <div
                    key={index}
                    className="border rounded-lg p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {uploadFile.status === "success" ? (
                          <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
                        ) : uploadFile.status === "error" ? (
                          <X className="w-4 h-4 text-red-600 flex-shrink-0" />
                        ) : (
                          <File className="w-4 h-4 text-blue-600 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {uploadFile.file.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatFileSize(uploadFile.file.size)}
                          </p>
                        </div>
                      </div>
                      {uploadFile.status === "pending" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(index)}
                          disabled={uploading}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>

                    {/* Progress bar */}
                    {uploadFile.status === "uploading" && (
                      <div className="space-y-1">
                        <Progress value={uploadFile.progress} />
                        <p className="text-xs text-gray-500 text-right">
                          {uploadFile.progress}%
                        </p>
                      </div>
                    )}

                    {/* Error message */}
                    {uploadFile.status === "error" && uploadFile.error && (
                      <p className="text-xs text-red-600">{uploadFile.error}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
              setFiles([]);
            }}
            disabled={uploading}
          >
            取消
          </Button>
          <Button
            onClick={handleUploadAll}
            disabled={files.length === 0 || uploading}
          >
            {uploading ? "上传中..." : `上传 ${files.length} 个文件`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

