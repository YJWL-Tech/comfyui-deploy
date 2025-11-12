/**
 * Worker 初始化模块
 * 
 * 此模块提供手动初始化机制，通过 UI 按钮触发
 * 点击 "启动 Worker" 按钮时会调用此模块初始化 worker
 */

// 全局变量来跟踪初始化状态
declare global {
    var workerInitialized: boolean | undefined;
    var initializationInProgress: boolean | undefined;
}

let initPromise: Promise<void> | null = null;

/**
 * 初始化 Worker
 * 使用单例模式确保只初始化一次
 */
export async function initializeWorkerAndChecker() {
    // 如果已经在初始化中，等待完成
    if (initPromise) {
        return initPromise;
    }

    // 如果已经初始化，直接返回
    if (global.workerInitialized) {
        return;
    }

    // 如果正在初始化，等待
    if (global.initializationInProgress) {
        return initPromise;
    }

    // 开始初始化
    global.initializationInProgress = true;
    initPromise = (async () => {
        try {
            console.log('\n' + '='.repeat(60));
            console.log('🔧 [MANUAL-INIT] Initializing worker (triggered manually)...');
            console.log('='.repeat(60));

            // 初始化 Worker
            if (!global.workerInitialized && process.env.ENABLE_WORKER_IN_NEXTJS === 'true') {
                if (!process.env.VERCEL && !process.env.NETLIFY && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
                    try {
                        console.log('📦 [MANUAL-INIT] Loading integrated worker...');
                        const { startWorker } = await import('../worker/queue-worker-integrated');
                        startWorker();
                        global.workerInitialized = true;
                        console.log('✅ [MANUAL-INIT] Worker initialized');
                    } catch (error) {
                        console.error('❌ [MANUAL-INIT] Failed to initialize worker:', error);
                    }
                } else {
                    console.log('⚠️  [MANUAL-INIT] Skipping worker in serverless environment');
                }
            } else {
                console.log('ℹ️  [MANUAL-INIT] Worker disabled (ENABLE_WORKER_IN_NEXTJS not set to true)');
            }

            // 初始化 Notification Worker（如果启用）
            if (process.env.ENABLE_NOTIFICATION_WORKER_IN_NEXTJS === 'true') {
                if (!process.env.VERCEL && !process.env.NETLIFY && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
                    try {
                        console.log('📦 [MANUAL-INIT] Loading integrated notification worker...');
                        const { startNotificationWorker } = await import('../worker/notification-worker-integrated');
                        startNotificationWorker();
                        console.log('✅ [MANUAL-INIT] Notification Worker initialized');
                    } catch (error) {
                        console.error('❌ [MANUAL-INIT] Failed to initialize notification worker:', error);
                    }
                } else {
                    console.log('⚠️  [MANUAL-INIT] Skipping notification worker in serverless environment');
                }
            }


            console.log('='.repeat(60));
            console.log('✅ [MANUAL-INIT] Initialization completed');
            console.log('='.repeat(60) + '\n');
        } catch (error) {
            console.error('❌ [MANUAL-INIT] Initialization error:', error);
            // 如果初始化失败，重置状态以便重试
            global.workerInitialized = false;
        } finally {
            global.initializationInProgress = false;
            // 初始化完成后重置 promise，允许后续重新初始化
            initPromise = null;
        }
    })();

    return initPromise;
}

/**
 * 检查是否已初始化
 */
export function isInitialized() {
    return {
        workerInitialized: global.workerInitialized || false,
    };
}

/**
 * 停止 Worker
 */
export async function stopWorkerAndChecker(force: boolean = false) {
    console.log('\n' + '='.repeat(60));
    console.log('🛑 [MANUAL-STOP] Stopping worker (triggered manually)...');
    if (force) {
        console.log('⚠️  [MANUAL-STOP] Force stop enabled');
    }
    console.log('='.repeat(60));

    let stoppedWorker = false;

    try {
        // 停止 Worker
        if (global.workerInitialized) {
            try {
                console.log('📦 [MANUAL-STOP] Stopping integrated worker...');
                const { stopWorker } = await import('../worker/queue-worker-integrated');
                await stopWorker(force);
                stoppedWorker = true;
                console.log('✅ [MANUAL-STOP] Worker stopped');
            } catch (error) {
                console.error('❌ [MANUAL-STOP] Failed to stop worker:', error);
            }
        }

        // 重置所有状态，确保可以重新启动
        global.workerInitialized = false;
        global.initializationInProgress = false;
        initPromise = null;

        console.log('='.repeat(60));
        console.log('✅ [MANUAL-STOP] Stop operation completed');
        console.log('='.repeat(60) + '\n');

        return {
            stoppedWorker,
        };
    } catch (error) {
        console.error('❌ [MANUAL-STOP] Stop error:', error);
        // 即使出错也要重置状态
        global.workerInitialized = false;
        global.initializationInProgress = false;
        initPromise = null;
        throw error;
    }
}

/**
 * 获取初始化状态详情
 */
export function getInitializationStatus() {
    const isServerless = !!(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);
    const enableWorker = process.env.ENABLE_WORKER_IN_NEXTJS === 'true';

    return {
        worker: {
            enabled: enableWorker,
            initialized: global.workerInitialized || false,
            serverless: isServerless,
            message: isServerless
                ? "Serverless 环境不支持 Worker"
                : !enableWorker
                    ? "Worker 未启用 (ENABLE_WORKER_IN_NEXTJS 未设置为 true)"
                    : global.workerInitialized
                        ? "Worker 已初始化"
                        : "Worker 未初始化",
        },
        environment: {
            nodeEnv: process.env.NODE_ENV || 'unknown',
            isServerless,
            redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
            workerConcurrency: process.env.WORKER_CONCURRENCY || '5',
        },
    };
}

