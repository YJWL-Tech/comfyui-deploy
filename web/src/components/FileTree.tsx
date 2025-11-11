"use client";

import { Folder, ChevronRight, ChevronDown, Home } from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "@/lib/utils";
import type { FolderItem } from "./FilesManager";
import { LoadingIcon } from "./LoadingIcon";
import { useState, useEffect } from "react";

interface FileTreeProps {
  currentPath: string;
  onPathChange: (path: string) => void;
  apiKey: string;
  mode: "personal" | "shared";
}

interface TreeNode {
  name: string;
  prefix: string;
  children: TreeNode[];
  isExpanded: boolean;
  isLoaded: boolean;
  isLoading: boolean;
}

export function FileTree({
  currentPath,
  onPathChange,
  apiKey,
  mode,
}: FileTreeProps) {
  const [rootFolders, setRootFolders] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);

  // Load folders for a given path
  const loadFolders = async (path: string): Promise<FolderItem[]> => {
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
      return data.folders || [];
    } catch (error) {
      console.error("Error loading folders:", error);
      return [];
    }
  };

  // Load root folders
  useEffect(() => {
    const loadRoot = async () => {
      if (!apiKey) return;
      setLoading(true);
      const folders = await loadFolders("");
      setRootFolders(
        folders.map((f) => ({
          name: f.name,
          prefix: f.prefix,
          children: [],
          isExpanded: false,
          isLoaded: false,
          isLoading: false,
        }))
      );
      setLoading(false);
    };
    loadRoot();
  }, [apiKey, mode]);

  // Toggle folder expansion
  const toggleFolder = async (nodePrefix: string) => {
    // Find the node by prefix
    const findAndUpdateNode = (
      nodes: TreeNode[],
      prefix: string,
      updateFn: (node: TreeNode) => TreeNode
    ): TreeNode[] => {
      return nodes.map((n) => {
        if (n.prefix === prefix) {
          return updateFn(n);
        }
        if (n.children.length > 0) {
          return {
            ...n,
            children: findAndUpdateNode(n.children, prefix, updateFn),
          };
        }
        return n;
      });
    };

    const findNode = (nodes: TreeNode[], prefix: string): TreeNode | null => {
      for (const n of nodes) {
        if (n.prefix === prefix) return n;
        if (n.children.length > 0) {
          const found = findNode(n.children, prefix);
          if (found) return found;
        }
      }
      return null;
    };

    const node = findNode(rootFolders, nodePrefix);
    if (!node) return;

    if (!node.isExpanded && !node.isLoaded) {
      // Set loading state
      setRootFolders((prev) =>
        findAndUpdateNode(prev, nodePrefix, (n) => ({ ...n, isLoading: true }))
      );

      // Load children
      const folders = await loadFolders(nodePrefix);
      const children: TreeNode[] = folders.map((f) => ({
        name: f.name,
        prefix: f.prefix,
        children: [],
        isExpanded: false,
        isLoaded: false,
        isLoading: false,
      }));

      // Update node with children
      setRootFolders((prev) =>
        findAndUpdateNode(prev, nodePrefix, (n) => ({
          ...n,
          children,
          isExpanded: true,
          isLoaded: true,
          isLoading: false,
        }))
      );
    } else {
      // Just toggle expansion
      setRootFolders((prev) =>
        findAndUpdateNode(prev, nodePrefix, (n) => ({
          ...n,
          isExpanded: !n.isExpanded,
        }))
      );
    }
  };

  // Render tree node recursively
  const renderNode = (node: TreeNode, depth: number) => {
    const isSelected = currentPath === node.prefix;
    const hasChildren = node.children.length > 0 || !node.isLoaded;

    return (
      <div key={node.prefix}>
        <div
          className={cn(
            "flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-gray-100 cursor-pointer transition-colors",
            isSelected && "bg-blue-50 hover:bg-blue-100"
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFolder(node.prefix);
              }}
              className="p-0.5 hover:bg-gray-200 rounded"
            >
              {node.isLoading ? (
                <LoadingIcon className="w-3 h-3" />
              ) : node.isExpanded ? (
                <ChevronDown className="w-3 h-3 text-gray-600" />
              ) : (
                <ChevronRight className="w-3 h-3 text-gray-600" />
              )}
            </button>
          )}
          {!hasChildren && <div className="w-4" />}
          <button
            onClick={() => onPathChange(node.prefix)}
            className="flex items-center gap-2 flex-1 min-w-0"
          >
            <Folder
              className={cn(
                "w-4 h-4 flex-shrink-0",
                isSelected ? "text-blue-500" : "text-yellow-500"
              )}
            />
            <span
              className={cn(
                "text-sm truncate",
                isSelected && "font-medium text-blue-600"
              )}
            >
              {node.name}
            </span>
          </button>
        </div>
        {node.isExpanded && node.children.length > 0 && (
          <div>
            {node.children.map((child) =>
              renderNode(child, depth + 1)
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <ScrollArea className="flex-1">
      <div className="p-2">
        {/* Root directory */}
        <button
          onClick={() => onPathChange("")}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-gray-100 text-left transition-colors",
            currentPath === "" && "bg-blue-50 font-medium"
          )}
        >
          <Home
            className={cn(
              "w-4 h-4",
              currentPath === "" ? "text-blue-500" : "text-gray-600"
            )}
          />
          <span
            className={cn(
              "text-sm",
              currentPath === "" && "text-blue-600 font-medium"
            )}
          >
            根目录
          </span>
        </button>

        {/* Tree structure */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <LoadingIcon />
          </div>
        ) : (
          <div className="mt-2">
            {rootFolders.map((node) => renderNode(node, 0))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

