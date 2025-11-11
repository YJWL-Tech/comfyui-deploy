"use client";

import { File, Folder, Download, Trash2, MoreVertical, Copy } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import type { FileItem, FolderItem } from "./FilesManager";
import { LoadingIcon } from "./LoadingIcon";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { useState } from "react";

interface FileListProps {
  files: FileItem[];
  folders: FolderItem[];
  loading: boolean;
  onDelete: (key: string, isFolder: boolean) => void;
  onDownload: (key: string) => void;
  onFolderClick: (prefix: string) => void;
  currentPath: string;
  apiKey: string;
  mode: "personal" | "shared";
}

export function FileList({
  files,
  folders,
  loading,
  onDelete,
  onDownload,
  onFolderClick,
  currentPath,
  apiKey,
  mode,
}: FileListProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{
    key: string;
    name: string;
    isFolder: boolean;
  } | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [currentFile, setCurrentFile] = useState<{
    name: string;
    key: string;
    downloadUrl?: string;
  } | null>(null);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
  };

  const handleDeleteClick = (key: string, name: string, isFolder: boolean) => {
    setItemToDelete({ key, name, isFolder });
    setDeleteDialogOpen(true);
    setOpenMenuKey(null); // 关闭当前打开的菜单
  };

  const confirmDelete = () => {
    if (itemToDelete) {
      onDelete(itemToDelete.key, itemToDelete.isFolder);
      setDeleteDialogOpen(false);
      setItemToDelete(null);
    }
  };

  const handleDeleteDialogChange = (open: boolean) => {
    setDeleteDialogOpen(open);
    if (!open) {
      // 对话框关闭时清空状态
      setItemToDelete(null);
    }
  };

  const handleShowLinks = async (file: FileItem) => {
    setOpenMenuKey(null); // 关闭菜单
    try {
      if (!apiKey) {
        toast.error("API密钥未加载");
        return;
      }

      // 获取下载URL
      const response = await fetch(
        `/api/files/download-url?key=${encodeURIComponent(file.key)}&mode=${mode}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setCurrentFile({
          name: file.name,
          key: file.key,
          downloadUrl: data.downloadUrl,
        });
        setLinkDialogOpen(true);
      } else {
        toast.error("获取下载链接失败");
      }
    } catch (error) {
      console.error("Error getting download URL:", error);
      toast.error("获取下载链接失败");
    }
  };

  const handleDownloadClick = (key: string) => {
    setOpenMenuKey(null); // 关闭菜单
    onDownload(key);
  };

  const handleLinkDialogChange = (open: boolean) => {
    setLinkDialogOpen(open);
    if (!open) {
      // 对话框关闭时清空状态
      setCurrentFile(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingIcon />
      </div>
    );
  }

  if (folders.length === 0 && files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <Folder className="w-16 h-16 mb-4" />
        <p>此目录为空</p>
        <p className="text-sm">上传文件或创建新文件夹开始使用</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead>名称</TableHead>
              <TableHead>大小</TableHead>
              <TableHead>修改时间</TableHead>
              <TableHead className="w-20">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Folders */}
            {folders.map((folder) => (
              <TableRow
                key={folder.prefix}
                className="cursor-pointer hover:bg-gray-50"
                onClick={() => onFolderClick(folder.prefix)}
              >
                <TableCell>
                  <Folder className="w-5 h-5 text-yellow-500" />
                </TableCell>
                <TableCell className="font-medium">{folder.name}</TableCell>
                <TableCell className="text-gray-500">-</TableCell>
                <TableCell className="text-gray-500">-</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu
                    open={openMenuKey === folder.prefix}
                    onOpenChange={(open) => setOpenMenuKey(open ? folder.prefix : null)}
                  >
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-red-600"
                        onClick={() =>
                          handleDeleteClick(folder.prefix, folder.name, true)
                        }
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        删除文件夹
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}

            {/* Files */}
            {files.map((file) => (
              <TableRow key={file.key} className="hover:bg-gray-50">
                <TableCell>
                  <File className="w-5 h-5 text-blue-500" />
                </TableCell>
                <TableCell className="font-medium">{file.name}</TableCell>
                <TableCell className="text-gray-500">
                  {formatFileSize(file.size)}
                </TableCell>
                <TableCell className="text-gray-500">
                  {file.lastModified &&
                    formatDistanceToNow(new Date(file.lastModified), {
                      addSuffix: true,
                      locale: zhCN,
                    })}
                </TableCell>
                <TableCell>
                  <DropdownMenu
                    open={openMenuKey === file.key}
                    onOpenChange={(open) => setOpenMenuKey(open ? file.key : null)}
                  >
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleDownloadClick(file.key)}>
                        <Download className="w-4 h-4 mr-2" />
                        下载
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleShowLinks(file)}>
                        <Copy className="w-4 h-4 mr-2" />
                        查看链接
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-red-600"
                        onClick={() =>
                          handleDeleteClick(file.key, file.name, false)
                        }
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={handleDeleteDialogChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              您确定要删除 "{itemToDelete?.name}" 吗？
              {itemToDelete?.isFolder &&
                " 此操作将删除文件夹中的所有内容。"}
              此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 链接查看对话框 */}
      <Dialog open={linkDialogOpen} onOpenChange={handleLinkDialogChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>文件链接</DialogTitle>
            <DialogDescription>
              {currentFile?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                文件路径
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={currentFile?.key || ""}
                  className="flex-1 px-3 py-2 border rounded-md bg-gray-50 font-mono text-sm"
                  onClick={(e) => e.currentTarget.select()}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const input = document.querySelector('input[value="' + currentFile?.key + '"]') as HTMLInputElement;
                    input?.select();
                    document.execCommand('copy');
                    toast.success("已复制");
                  }}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                点击输入框可以选中全部文本
              </p>
            </div>
            
            {currentFile?.downloadUrl && (
              <div>
                <label className="text-sm font-medium mb-2 block">
                  下载链接（1小时有效）
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={currentFile.downloadUrl}
                    className="flex-1 px-3 py-2 border rounded-md bg-gray-50 font-mono text-sm"
                    onClick={(e) => e.currentTarget.select()}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const input = document.querySelector('input[value="' + currentFile.downloadUrl + '"]') as HTMLInputElement;
                      input?.select();
                      document.execCommand('copy');
                      toast.success("已复制");
                    }}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  点击输入框可以选中全部文本
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => handleLinkDialogChange(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

