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
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
    RefreshCw,
    FileIcon,
    Server,
    CheckCircle,
    XCircle,
    Clock,
    Download,
    Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { getPushTasks, deletePushTask } from "@/app/(app)/models/push/actions";

interface PushTask {
    id: string;
    model_id: string;
    machine_id: string | null;
    machine_group_id: string | null;
    status: string;
    progress: number | null;
    error_message: string | null;
    created_at: Date;
    model?: {
        filename: string;
        folder_path: string;
        file_size: number | null;
    };
    machine?: {
        name: string;
    } | null;
}

export function ModelPushTasks() {
    const [tasks, setTasks] = useState<PushTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [deleting, setDeleting] = useState<string | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);

    useEffect(() => {
        fetchTasks();
    }, [statusFilter]);

    useEffect(() => {
        if (!autoRefresh) return;

        const interval = setInterval(() => {
            // 只在有进行中的任务时自动刷新
            const hasActiveTasks = tasks.some(
                (task) => task.status === "pending" || task.status === "downloading"
            );
            if (hasActiveTasks) {
                fetchTasks();
            }
        }, 5000); // 每5秒刷新一次

        return () => clearInterval(interval);
    }, [autoRefresh, tasks]);

    const fetchTasks = async () => {
        try {
            setLoading(true);
            const filters = statusFilter !== "all" ? { status: statusFilter } : {};
            const data = await getPushTasks(filters);
            setTasks(data);
        } catch (error) {
            console.error("Error fetching tasks:", error);
            toast.error("加载任务列表失败");
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (taskId: string) => {
        if (!confirm("确定要删除这个任务记录吗？")) {
            return;
        }

        try {
            setDeleting(taskId);
            await deletePushTask(taskId);
            toast.success("任务删除成功");
            fetchTasks();
        } catch (error) {
            console.error("Error deleting task:", error);
            toast.error("删除任务失败");
        } finally {
            setDeleting(null);
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case "completed":
                return <CheckCircle className="h-4 w-4 text-green-500" />;
            case "failed":
                return <XCircle className="h-4 w-4 text-red-500" />;
            case "downloading":
                return <Download className="h-4 w-4 text-blue-500 animate-pulse" />;
            default:
                return <Clock className="h-4 w-4 text-gray-500" />;
        }
    };

    const getStatusBadge = (status: string) => {
        const variants: Record<string, any> = {
            pending: "secondary",
            downloading: "default",
            completed: "success",
            failed: "destructive",
        };

        const labels: Record<string, string> = {
            pending: "等待中",
            downloading: "下载中",
            completed: "已完成",
            failed: "失败",
        };

        return (
            <Badge variant={variants[status] || "secondary"}>
                {labels[status] || status}
            </Badge>
        );
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

    if (loading && tasks.length === 0) {
        return (
            <Card>
                <CardContent className="py-8">
                    <div className="text-center text-muted-foreground">加载中...</div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle>推送任务</CardTitle>
                        <CardDescription>共 {tasks.length} 个任务</CardDescription>
                    </div>
                    <div className="flex gap-2">
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="w-[150px]">
                                <SelectValue placeholder="筛选状态" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">全部状态</SelectItem>
                                <SelectItem value="pending">等待中</SelectItem>
                                <SelectItem value="downloading">下载中</SelectItem>
                                <SelectItem value="completed">已完成</SelectItem>
                                <SelectItem value="failed">失败</SelectItem>
                            </SelectContent>
                        </Select>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={fetchTasks}
                            disabled={loading}
                        >
                            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {tasks.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">
                        <FileIcon className="mx-auto h-12 w-12 mb-4 opacity-50" />
                        <p>没有推送任务</p>
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>状态</TableHead>
                                <TableHead>模型</TableHead>
                                <TableHead>目标机器</TableHead>
                                <TableHead>进度</TableHead>
                                <TableHead>创建时间</TableHead>
                                <TableHead className="text-right">操作</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {tasks.map((task) => (
                                <TableRow key={task.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            {getStatusIcon(task.status)}
                                            {getStatusBadge(task.status)}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div>
                                            <div className="font-medium">
                                                {task.model?.filename || "未知"}
                                            </div>
                                            <div className="text-xs text-muted-foreground">
                                                {task.model?.folder_path}
                                            </div>
                                            {task.model?.file_size && (
                                                <div className="text-xs text-muted-foreground">
                                                    {formatFileSize(task.model.file_size)}
                                                </div>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <Server className="h-4 w-4 text-muted-foreground" />
                                            <span>{task.machine?.name || "未知机器"}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {task.status === "downloading" && task.progress !== null ? (
                                            <div className="space-y-1">
                                                <Progress value={task.progress} className="w-[100px]" />
                                                <div className="text-xs text-muted-foreground">
                                                    {task.progress}%
                                                </div>
                                            </div>
                                        ) : task.status === "completed" ? (
                                            <div className="text-sm text-green-600">100%</div>
                                        ) : task.status === "failed" && task.error_message ? (
                                            <div
                                                className="text-xs text-red-600 max-w-[200px] truncate"
                                                title={task.error_message}
                                            >
                                                {task.error_message}
                                            </div>
                                        ) : (
                                            <div className="text-xs text-muted-foreground">-</div>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {formatDate(task.created_at)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => handleDelete(task.id)}
                                            disabled={deleting === task.id}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}

