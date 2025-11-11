"use client";

import { useEffect, useState, useRef } from "react";
import useWebSocket from "react-use-websocket";
import { getConnectionStatus } from "./getConnectionStatus";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Terminal, X, Maximize2, Minimize2 } from "lucide-react";

interface MachineRealtimeLogsProps {
    machineId: string;
    machineName: string;
    endpoint: string;
}

export function MachineRealtimeLogs({
    machineId,
    machineName,
    endpoint,
}: MachineRealtimeLogsProps) {
    const [logs, setLogs] = useState<string>("");
    const [isOpen, setIsOpen] = useState(false);
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const wsEndpoint = endpoint.replace(/^http/, "ws");
    const { lastMessage, readyState } = useWebSocket(
        // 只在对话框打开时连接
        isOpen ? `${wsEndpoint}/comfyui-deploy/logs/ws` : null,
        {
            shouldReconnect: () => isOpen, // 只在打开时重连
            reconnectAttempts: 20,
            reconnectInterval: 1000,
            onOpen: () => {
                console.log("Logs WebSocket connected to", `${wsEndpoint}/comfyui-deploy/logs/ws`);
            },
            onClose: () => {
                console.log("Logs WebSocket disconnected");
            },
            onError: (error) => {
                console.error("Logs WebSocket error:", error);
            },
        }
    );

    const connectionStatus = getConnectionStatus(readyState);

    useEffect(() => {
        if (!lastMessage?.data) return;

        try {
            const message = JSON.parse(lastMessage.data);
            console.log("Received log message:", message.event, message.data);

            if (message.event === "log") {
                setLogs((prev) => {
                    const newLogs = prev + message.data.content;
                    // 限制日志长度，只保留最后 50000 个字符
                    if (newLogs.length > 50000) {
                        return newLogs.slice(-50000);
                    }
                    return newLogs;
                });
            } else if (message.event === "error") {
                setLogs((prev) => prev + `\n[ERROR] ${message.data.message}\n`);
                console.error("Log error:", message.data.message);
            }
        } catch (error) {
            console.error("Error parsing log message:", error, lastMessage.data);
        }
    }, [lastMessage]);

    // 对话框关闭时清空日志
    useEffect(() => {
        if (!isOpen) {
            setLogs("");
        }
    }, [isOpen]);

    // 自动滚动到底部
    useEffect(() => {
        if (autoScroll && scrollAreaRef.current) {
            const scrollContainer = scrollAreaRef.current.querySelector(
                '[data-radix-scroll-area-viewport]'
            );
            if (scrollContainer) {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
            }
        }
    }, [logs, autoScroll]);

    const clearLogs = () => {
        setLogs("");
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                    <Terminal className="h-4 w-4" />
                    实时日志
                </Button>
            </DialogTrigger>
            <DialogContent
                className={`${isFullscreen ? "max-w-[95vw] max-h-[95vh]" : "max-w-4xl max-h-[80vh]"
                    }`}
            >
                <DialogHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <DialogTitle className="flex items-center gap-2">
                                实时日志 - {machineName}
                                <Badge variant="outline" className="text-xs">
                                    {connectionStatus}
                                </Badge>
                            </DialogTitle>
                            <DialogDescription>
                                查看 ComfyUI 后台实时日志（不持久化）
                            </DialogDescription>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setIsFullscreen(!isFullscreen)}
                                title={isFullscreen ? "退出全屏" : "全屏"}
                            >
                                {isFullscreen ? (
                                    <Minimize2 className="h-4 w-4" />
                                ) : (
                                    <Maximize2 className="h-4 w-4" />
                                )}
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={clearLogs}
                                title="清空日志"
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </DialogHeader>
                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-sm">
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={autoScroll}
                                onChange={(e) => setAutoScroll(e.target.checked)}
                                className="rounded"
                            />
                            <span>自动滚动</span>
                        </label>
                        <span className="text-muted-foreground">
                            {logs.length.toLocaleString()} 字符
                        </span>
                    </div>
                    <ScrollArea
                        ref={scrollAreaRef}
                        className="h-[60vh] w-full rounded-md border bg-black text-green-400 font-mono text-xs p-4"
                    >
                        <pre className="whitespace-pre-wrap break-words">
                            {logs || "等待日志..."}
                        </pre>
                    </ScrollArea>
                </div>
            </DialogContent>
        </Dialog>
    );
}

