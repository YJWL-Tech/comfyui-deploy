/**
 * 手动启动 Worker 的 API 路由
 * 用于调试或确保 worker 启动
 * 
 * 访问: GET /api/worker-start
 */

import { startWorker } from "@/worker/queue-worker-integrated";
import { NextResponse } from "next/server";

// 强制动态路由，防止在构建时被预渲染执行
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        console.log("🔧 [API] Manual worker start requested");
        startWorker();
        return NextResponse.json({
            success: true,
            message: "Worker start requested. Check server logs for status.",
        });
    } catch (error) {
        console.error("❌ [API] Failed to start worker:", error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 }
        );
    }
}

