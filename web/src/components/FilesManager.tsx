"use client";

import { useState, useEffect } from "react";
import { FileTree } from "./FileTree";
import { FileList } from "./FileList";
import { FileUploadDialog } from "./FileUploadDialog";
import { Button } from "./ui/button";
import { FolderPlus, Upload, User, Globe } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

export interface FileItem {
  name: string;
  key: string;
  size: number;
  lastModified: string;
  url?: string;
}

export interface FolderItem {
  name: string;
  prefix: string;
}

export interface FilesData {
  folders: FolderItem[];
  files: FileItem[];
}

export function FilesManager() {
  const [currentPath, setCurrentPath] = useState<string>("");
  const [filesData, setFilesData] = useState<FilesData>({
    folders: [],
    files: [],
  });
  const [loading, setLoading] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [apiKey, setApiKey] = useState<string>("");
  const [mode, setMode] = useState<"personal" | "shared">("personal");

  // Fetch files and folders
  const fetchFiles = async (path: string) => {
    if (!apiKey) {
      return;
    }

    setLoading(true);
    try {
      const url = `/api/files/list?prefix=${encodeURIComponent(path)}&mode=${mode}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error("获取文件列表失败");
      }

      const data = await response.json();
      setFilesData(data);
    } catch (error) {
      console.error("Error fetching files:", error);
      toast.error("获取文件列表失败");
    } finally {
      setLoading(false);
    }
  };

  // Create folder
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      toast.error("请输入文件夹名称");
      return;
    }

    if (!apiKey) {
      toast.error("API密钥未加载");
      return;
    }

    try {
      // Normalize folder name and path
      const normalizedFolderName = newFolderName.trim().replace(/\/+/g, "/");
      const folderPath = currentPath
        ? `${currentPath}/${normalizedFolderName}`
        : normalizedFolderName;

      const response = await fetch("/api/files/create-folder", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ path: folderPath, mode }),
      });

      if (!response.ok) {
        throw new Error("创建文件夹失败");
      }

      toast.success("文件夹创建成功");
      setCreateFolderOpen(false);
      setNewFolderName("");
      fetchFiles(currentPath);
    } catch (error) {
      console.error("Error creating folder:", error);
      toast.error("创建文件夹失败");
    }
  };

  // Delete file or folder
  const handleDelete = async (key: string, isFolder: boolean) => {
    if (!apiKey) {
      toast.error("API密钥未加载");
      return;
    }

    try {
      const response = await fetch("/api/files/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ key, isFolder, mode }),
      });

      if (!response.ok) {
        throw new Error("删除失败");
      }

      toast.success("删除成功");
      fetchFiles(currentPath);
    } catch (error) {
      console.error("Error deleting:", error);
      toast.error("删除失败");
    }
  };

  // Download file
  const handleDownload = async (key: string) => {
    if (!apiKey) {
      toast.error("API密钥未加载");
      return;
    }

    try {
      const response = await fetch(
        `/api/files/download-url?key=${encodeURIComponent(key)}&mode=${mode}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("获取下载链接失败");
      }

      const data = await response.json();
      window.open(data.downloadUrl, "_blank");
    } catch (error) {
      console.error("Error downloading:", error);
      toast.error("下载失败");
    }
  };

  // Load API key on mount
  useEffect(() => {
    const loadApiKey = async () => {
      try {
        const { getOrCreateApiKey } = await import("@/app/(app)/files/actions");
        const key = await getOrCreateApiKey();
        setApiKey(key);
      } catch (error) {
        console.error("Error loading API key:", error);
        toast.error("加载API密钥失败");
      }
    };
    loadApiKey();
  }, []);

  useEffect(() => {
    if (apiKey) {
      fetchFiles(currentPath);
    }
  }, [currentPath, apiKey, mode]);

  // Reset path when mode changes
  useEffect(() => {
    setCurrentPath("");
  }, [mode]);

  return (
    <div className="flex h-full border rounded-lg overflow-hidden bg-white">
      {/* Left sidebar - File Tree */}
      <div className="w-64 border-r flex flex-col">
        {/* Mode Switcher */}
        <div className="p-3 border-b bg-gray-50">
          <Tabs value={mode} onValueChange={(v) => setMode(v as "personal" | "shared")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="personal" className="text-xs">
                <User className="w-3 h-3 mr-1" />
                我的文件
              </TabsTrigger>
              <TabsTrigger value="shared" className="text-xs">
                <Globe className="w-3 h-3 mr-1" />
                共享目录
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        
        <div className="p-4 border-b bg-gray-50">
          <div className="flex gap-2">
            <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="flex-1">
                  <FolderPlus className="w-4 h-4 mr-2" />
                  新建文件夹
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>创建新文件夹</DialogTitle>
                  <DialogDescription>
                    在当前目录下创建一个新的文件夹
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="folder-name">文件夹名称</Label>
                    <Input
                      id="folder-name"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="输入文件夹名称"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleCreateFolder();
                        }
                      }}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setCreateFolderOpen(false)}
                  >
                    取消
                  </Button>
                  <Button onClick={handleCreateFolder}>创建</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        <FileTree
          currentPath={currentPath}
          onPathChange={setCurrentPath}
          apiKey={apiKey}
          mode={mode}
        />
      </div>

      {/* Right content - File List */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold">
              {currentPath || "根目录"}
            </h2>
            <p className="text-sm text-gray-500">
              {filesData.files.length} 个文件, {filesData.folders.length} 个文件夹
            </p>
          </div>
          <FileUploadDialog
            currentPath={currentPath}
            onUploadComplete={() => fetchFiles(currentPath)}
            apiKey={apiKey}
            mode={mode}
            trigger={
              <Button>
                <Upload className="w-4 h-4 mr-2" />
                上传文件
              </Button>
            }
          />
        </div>
        <FileList
          files={filesData.files}
          folders={filesData.folders}
          loading={loading}
          onDelete={handleDelete}
          onDownload={handleDownload}
          onFolderClick={(prefix) => setCurrentPath(prefix)}
          currentPath={currentPath}
          apiKey={apiKey}
          mode={mode}
        />
      </div>
    </div>
  );
}

