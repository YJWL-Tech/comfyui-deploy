/**
 * Next.js Instrumentation Hook
 * 
 * 此文件会在 Next.js 服务器启动时自动执行
 * 用于启动集成在 Next.js 中的 worker
 * 
 * 注意：
 * 1. 此实现主要用于开发环境或特定部署场景
 * 2. 生产环境建议使用独立的 worker 进程
 * 3. Serverless 环境（Vercel/Netlify）不支持，会自动跳过
 * 
 * 使用方法：
 * 1. 设置环境变量 ENABLE_WORKER_IN_NEXTJS=true 来启用
 * 2. 或者删除此文件，使用独立的 worker 进程
 */

export async function register() {
    // 只在 Node.js 运行时运行（非 Edge Runtime）
    if (process.env.NEXT_RUNTIME !== 'nodejs') {
        return;
    }

    // 检查是否启用集成 worker（默认不启用，建议使用独立进程）
    if (process.env.ENABLE_WORKER_IN_NEXTJS !== 'true') {
        console.log('Worker integration disabled. Use ENABLE_WORKER_IN_NEXTJS=true to enable.');
        return;
    }

    // Serverless 环境不支持长期运行的进程
    if (process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) {
        console.log('Skipping worker in serverless environment');
        return;
    }

    // 动态导入，避免在构建时执行
    try {
        const { startWorker } = await import('./src/worker/queue-worker-integrated');
        startWorker();
    } catch (error) {
        console.error('Failed to start integrated worker:', error);
    }
}

