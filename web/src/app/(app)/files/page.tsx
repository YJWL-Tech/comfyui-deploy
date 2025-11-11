"use client";

import { FilesManager } from "@/components/FilesManager";

export default function FilesPage() {
  return (
    <div className="flex flex-col h-full w-full py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">文件管理</h1>
        <p className="text-gray-600 mt-2">管理您在S3存储中的文件和目录</p>
      </div>
      <FilesManager />
    </div>
  );
}

