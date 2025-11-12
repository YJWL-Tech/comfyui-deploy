import { NotificationMonitor } from "@/components/NotificationMonitor";

export default function NotificationsPage() {
    return (
        <div className="flex flex-col h-full w-full py-8">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">通知队列管理</h1>
                <p className="text-gray-500 mt-2">
                    监控和管理 webhook 通知队列，查看待发送、成功、失败的通知状态
                </p>
            </div>
            <div className="flex-1 overflow-auto">
                <NotificationMonitor />
            </div>
        </div>
    );
}

