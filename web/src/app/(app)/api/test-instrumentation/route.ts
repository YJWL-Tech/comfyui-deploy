/**
 * 测试 Instrumentation 是否已执行的 API 路由
 * 用于验证 instrumentation.ts 是否正常工作
 */

import { NextResponse } from "next/server";
import { isInitialized, initializeWorkerAndChecker } from "@/server/initWorker";

// 强制动态路由，防止在构建时被预渲染执行
export const dynamic = 'force-dynamic';

// 全局变量来跟踪 instrumentation 是否已执行
declare global {
    var instrumentationExecuted: boolean | undefined;
    var instrumentationTimestamp: string | undefined;
}

export async function GET() {
    // 尝试初始化（如果还未初始化）
    const initStatus = isInitialized();
    if (!initStatus.workerInitialized) {
        // 非阻塞初始化
        initializeWorkerAndChecker().catch((error) => {
            console.error('❌ [test-instrumentation] Failed to initialize:', error);
        });
    }

    return NextResponse.json({
        instrumentation: {
            executed: global.instrumentationExecuted || false,
            timestamp: global.instrumentationTimestamp || null,
        },
        autoInit: {
            workerInitialized: initStatus.workerInitialized,
        },
        environment: {
            nextRuntime: process.env.NEXT_RUNTIME,
            nodeEnv: process.env.NODE_ENV,
            enableWorker: process.env.ENABLE_WORKER_IN_NEXTJS,
        },
        message: global.instrumentationExecuted
            ? "✅ Instrumentation has been executed"
            : initStatus.workerInitialized
                ? "⚠️  Instrumentation not executed, but auto-init is working"
                : "❌ Neither instrumentation nor auto-init has executed yet",
    });
}

