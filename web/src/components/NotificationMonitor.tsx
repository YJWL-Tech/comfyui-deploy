"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, Play, Square, AlertTriangle, CheckCircle, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";
import { getRelativeTime } from "@/lib/getRelativeTime";
import {
    getNotificationQueueData,
    startNotificationWorkerAction,
    stopNotificationWorkerAction,
    getNotificationWorkerStatusAction,
    cleanNotificationQueue,
} from "@/server/notifications/notificationServerActions";
import { callServerPromise } from "@/components/callServerPromise";

interface NotificationStatus {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
}

interface NotificationJob {
    id: string;
    name: string;
    workflow_run_id: string;
    status: "success" | "failed";
    webhook_url: string;
    created_at: string;
    processed_on: string | null;
    finished_on: string | null;
    attempts: number;
    failed_reason?: string;
    returnvalue?: any;
}

interface NotificationData {
    status: NotificationStatus;
    jobs: {
        waiting: NotificationJob[];
        active: NotificationJob[];
        completed: NotificationJob[];
        failed: NotificationJob[];
        delayed: NotificationJob[];
    };
}

interface WorkerStatus {
    isRunning: boolean;
    redisConnected: boolean;
    concurrency: string;
}

export function NotificationMonitor() {
    const [data, setData] = useState<NotificationData | null>(null);
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [startingWorker, setStartingWorker] = useState(false);
    const [stoppingWorker, setStoppingWorker] = useState(false);
    const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null);
    const [cleaning, setCleaning] = useState<string | null>(null);

    // 获取通知队列数据
    const fetchNotificationData = async () => {
        try {
            const notificationData = await callServerPromise(getNotificationQueueData());
            setData(notificationData);
            
            // 如果有待发送或失败的通知，但 Worker 未运行，显示警告
            if (notificationData && workerStatus && !workerStatus.isRunning) {
                const hasPending = notificationData.status.waiting > 0 || 
                                 notificationData.status.failed > 0 ||
                                 notificationData.status.active > 0;
                if (hasPending) {
                    console.warn("⚠️ 有待处理的通知，但 Notification Worker 未运行！");
                }
            }
        } catch (error) {
            console.error("Error fetching notification data:", error);
            toast.error("获取通知队列数据失败");
        } finally {
            setLoading(false);
        }
    };

    // 获取 Worker 状态
    const fetchWorkerStatus = async () => {
        try {
            const status = await callServerPromise(getNotificationWorkerStatusAction());
            setWorkerStatus(status);
        } catch (error) {
            console.error("Error fetching worker status:", error);
        }
    };

    // 初始加载
    useEffect(() => {
        fetchNotificationData();
        fetchWorkerStatus();
    }, []);

    // 自动刷新
    useEffect(() => {
        if (!autoRefresh) return;

        const interval = setInterval(() => {
            fetchNotificationData();
            fetchWorkerStatus();
        }, 3000); // 每 3 秒刷新一次

        return () => clearInterval(interval);
    }, [autoRefresh]);

    // 手动启动 Worker
    const handleStartWorker = async () => {
        setStartingWorker(true);
        try {
            const result = await callServerPromise(startNotificationWorkerAction());
            if (result.success) {
                toast.success(result.message || "Notification Worker 启动成功");
                await fetchWorkerStatus();
            } else {
                toast.error(result.message || "启动 Notification Worker 失败");
            }
        } catch (error) {
            console.error("Error starting worker:", error);
            toast.error(error instanceof Error ? error.message : "启动 Notification Worker 失败");
        } finally {
            setStartingWorker(false);
        }
    };

    // 手动停止 Worker
    const handleStopWorker = async () => {
        if (!confirm("确定要停止 Notification Worker 吗？")) {
            return;
        }

        setStoppingWorker(true);
        try {
            const result = await callServerPromise(stopNotificationWorkerAction(true));
            if (result.success) {
                toast.success(result.message || "Notification Worker 已停止");
                await fetchWorkerStatus();
            } else {
                toast.error(result.message || "停止 Notification Worker 失败");
            }
        } catch (error) {
            console.error("Error stopping worker:", error);
            toast.error(error instanceof Error ? error.message : "停止 Notification Worker 失败");
        } finally {
            setStoppingWorker(false);
        }
    };

    // 清理队列
    const handleCleanQueue = async (status: "waiting" | "active" | "completed" | "failed" | "delayed") => {
        if (!confirm(`确定要清理所有 ${status} 状态的通知吗？`)) {
            return;
        }

        setCleaning(status);
        try {
            const result = await callServerPromise(cleanNotificationQueue(status));
            if (result.success) {
                toast.success(result.message || `已清理 ${result.cleaned} 个通知`);
                await fetchNotificationData();
            } else {
                toast.error(result.message || "清理失败");
            }
        } catch (error) {
            console.error("Error cleaning queue:", error);
            toast.error("清理失败");
        } finally {
            setCleaning(null);
        }
    };

    const renderJobTable = (jobs: NotificationJob[], title: string, statusColor: string) => {
        if (jobs.length === 0) {
            return (
                <div className="text-center py-8 text-gray-500">
                    暂无 {title} 状态的通知
                </div>
            );
        }

        return (
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-[200px]">Workflow Run ID</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>Webhook URL</TableHead>
                        <TableHead>创建时间</TableHead>
                        <TableHead>处理时间</TableHead>
                        <TableHead>完成时间</TableHead>
                        <TableHead>重试次数</TableHead>
                        {statusColor === "failed" && <TableHead>失败原因</TableHead>}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {jobs.map((job) => (
                        <TableRow key={job.id}>
                            <TableCell className="font-mono text-xs">
                                {job.workflow_run_id.substring(0, 8)}...
                            </TableCell>
                            <TableCell>
                                <Badge variant={statusColor === "failed" ? "destructive" : "default"}>
                                    {job.status}
                                </Badge>
                            </TableCell>
                            <TableCell className="max-w-[300px] truncate text-xs">
                                {job.webhook_url}
                            </TableCell>
                            <TableCell className="text-xs">
                                {getRelativeTime(new Date(job.created_at))}
                            </TableCell>
                            <TableCell className="text-xs">
                                {job.processed_on ? getRelativeTime(new Date(job.processed_on)) : "-"}
                            </TableCell>
                            <TableCell className="text-xs">
                                {job.finished_on ? getRelativeTime(new Date(job.finished_on)) : "-"}
                            </TableCell>
                            <TableCell>
                                <Badge variant="outline">{job.attempts}</Badge>
                            </TableCell>
                            {statusColor === "failed" && (
                                <TableCell className="max-w-[200px] truncate text-xs text-red-600">
                                    {job.failed_reason || "-"}
                                </TableCell>
                            )}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        );
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <RefreshCw className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Worker 控制面板 */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Notification Worker 控制</CardTitle>
                            <CardDescription>
                                管理通知 Worker 的启动和停止
                                {data && (data.status.waiting > 0 || data.status.failed > 0) && !workerStatus?.isRunning && (
                                    <span className="text-red-500 block mt-1 font-semibold">
                                        ⚠️ 警告：有待处理的通知（待发送: {data.status.waiting}, 失败: {data.status.failed}），但 Worker 未运行！
                                        <br />
                                        请点击"启动 Worker"按钮以开始发送通知。
                                    </span>
                                )}
                                {!workerStatus?.isRunning && (
                                    <span className="text-orange-500 block mt-1">
                                        ℹ️ Worker 未运行，通知将被加入队列但不会发送，直到 Worker 启动。
                                    </span>
                                )}
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    fetchNotificationData();
                                    fetchWorkerStatus();
                                }}
                            >
                                <RefreshCw className="h-4 w-4 mr-2" />
                                刷新
                            </Button>
                            {workerStatus?.isRunning ? (
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={handleStopWorker}
                                    disabled={stoppingWorker}
                                >
                                    <Square className="h-4 w-4 mr-2" />
                                    {stoppingWorker ? "停止中..." : "停止 Worker"}
                                </Button>
                            ) : (
                                <Button
                                    variant="default"
                                    size="sm"
                                    onClick={handleStartWorker}
                                    disabled={startingWorker}
                                >
                                    <Play className="h-4 w-4 mr-2" />
                                    {startingWorker ? "启动中..." : "启动 Worker"}
                                </Button>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <div className="text-sm text-gray-500">Worker 状态</div>
                            <div className="text-lg font-semibold">
                                {workerStatus?.isRunning ? (
                                    <Badge className="bg-green-500">运行中</Badge>
                                ) : (
                                    <Badge variant="secondary">已停止</Badge>
                                )}
                            </div>
                        </div>
                        <div>
                            <div className="text-sm text-gray-500">Redis 连接</div>
                            <div className="text-lg font-semibold">
                                {workerStatus?.redisConnected ? (
                                    <Badge className="bg-green-500">已连接</Badge>
                                ) : (
                                    <Badge variant="secondary">未连接</Badge>
                                )}
                            </div>
                        </div>
                        <div>
                            <div className="text-sm text-gray-500">并发数</div>
                            <div className="text-lg font-semibold">{workerStatus?.concurrency || "10"}</div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* 队列状态概览 */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>通知队列状态</CardTitle>
                            <CardDescription>
                                实时监控通知队列的状态
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={autoRefresh}
                                    onChange={(e) => setAutoRefresh(e.target.checked)}
                                    className="rounded"
                                />
                                自动刷新
                            </label>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {data && (
                        <div className="grid grid-cols-5 gap-4">
                            <div className="text-center p-4 border rounded-lg">
                                <Clock className="h-6 w-6 mx-auto mb-2 text-blue-500" />
                                <div className="text-2xl font-bold">{data.status.waiting}</div>
                                <div className="text-sm text-gray-500">待发送</div>
                            </div>
                            <div className="text-center p-4 border rounded-lg">
                                <RefreshCw className="h-6 w-6 mx-auto mb-2 text-yellow-500 animate-spin" />
                                <div className="text-2xl font-bold">{data.status.active}</div>
                                <div className="text-sm text-gray-500">发送中</div>
                            </div>
                            <div className="text-center p-4 border rounded-lg">
                                <CheckCircle className="h-6 w-6 mx-auto mb-2 text-green-500" />
                                <div className="text-2xl font-bold">{data.status.completed}</div>
                                <div className="text-sm text-gray-500">成功</div>
                            </div>
                            <div className="text-center p-4 border rounded-lg">
                                <XCircle className="h-6 w-6 mx-auto mb-2 text-red-500" />
                                <div className="text-2xl font-bold">{data.status.failed}</div>
                                <div className="text-sm text-gray-500">失败</div>
                            </div>
                            <div className="text-center p-4 border rounded-lg">
                                <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-orange-500" />
                                <div className="text-2xl font-bold">{data.status.delayed}</div>
                                <div className="text-sm text-gray-500">延迟</div>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* 详细任务列表 */}
            {data && (
                <div className="space-y-4">
                    {/* 待发送 */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle className="flex items-center gap-2">
                                    <Clock className="h-5 w-5 text-blue-500" />
                                    待发送 ({data.status.waiting})
                                </CardTitle>
                                {data.status.waiting > 0 && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleCleanQueue("waiting")}
                                        disabled={cleaning === "waiting"}
                                    >
                                        {cleaning === "waiting" ? "清理中..." : "清理"}
                                    </Button>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent>
                            <ScrollArea className="h-[200px]">
                                {renderJobTable(data.jobs.waiting, "待发送", "waiting")}
                            </ScrollArea>
                        </CardContent>
                    </Card>

                    {/* 发送中 */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <RefreshCw className="h-5 w-5 text-yellow-500 animate-spin" />
                                发送中 ({data.status.active})
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ScrollArea className="h-[200px]">
                                {renderJobTable(data.jobs.active, "发送中", "active")}
                            </ScrollArea>
                        </CardContent>
                    </Card>

                    {/* 成功 */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle className="flex items-center gap-2">
                                    <CheckCircle className="h-5 w-5 text-green-500" />
                                    成功 ({data.status.completed})
                                </CardTitle>
                                {data.status.completed > 0 && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleCleanQueue("completed")}
                                        disabled={cleaning === "completed"}
                                    >
                                        {cleaning === "completed" ? "清理中..." : "清理"}
                                    </Button>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent>
                            <ScrollArea className="h-[200px]">
                                {renderJobTable(data.jobs.completed, "成功", "completed")}
                            </ScrollArea>
                        </CardContent>
                    </Card>

                    {/* 失败 */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle className="flex items-center gap-2">
                                    <XCircle className="h-5 w-5 text-red-500" />
                                    失败 ({data.status.failed})
                                </CardTitle>
                                {data.status.failed > 0 && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleCleanQueue("failed")}
                                        disabled={cleaning === "failed"}
                                    >
                                        {cleaning === "failed" ? "清理中..." : "清理"}
                                    </Button>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent>
                            <ScrollArea className="h-[300px]">
                                {renderJobTable(data.jobs.failed, "失败", "failed")}
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}

