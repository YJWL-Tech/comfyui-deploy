#!/bin/bash

# ComfyDeploy Restart Script
# 用法: ./restart.sh

cd "$(dirname "$0")"

echo "=========================================="
echo "ComfyDeploy Restart"
echo "=========================================="

# 1. 停止旧进程
echo "[1/3] 停止旧进程..."

# 杀掉所有相关进程
pkill -f "bun.*start" 2>/dev/null

# 如果有 PID 文件，也处理一下
if [ -f comfydeploy.pid ]; then
    kill $(cat comfydeploy.pid) 2>/dev/null
    rm -f comfydeploy.pid
fi

sleep 2
echo "✓ 旧进程已停止"

# 2. 加载 .env
echo "[2/3] 加载环境变量..."
if [ -f .env ]; then
    set -a
    source .env
    set +a
    echo "✓ API_URL=$API_URL"
    echo "✓ NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL"
else
    echo "⚠️ 未找到 .env 文件"
fi

# 3. 启动
echo "[3/3] 启动服务..."
nohup bun run start > comfydeploy.log 2>&1 &
echo $! > comfydeploy.pid

echo ""
echo "=========================================="
echo "✅ 启动成功！"
echo "   PID: $(cat comfydeploy.pid)"
echo "   日志: tail -f comfydeploy.log"
echo "=========================================="
