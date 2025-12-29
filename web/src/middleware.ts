import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// 公开路由（不需要登录）
const publicRoutes = [
  "/",
  "/login",
  "/api/auth",
  "/api/webhook",
  "/api/update-run",
  "/api/file-upload",
  "/api/machine-built",
  "/docs",
  "/share",
];

// 检查路径是否匹配公开路由
function isPublicRoute(pathname: string): boolean {
  return publicRoutes.some((route) => {
    if (route === pathname) return true;
    if (route.endsWith("/")) return pathname.startsWith(route);
    return pathname.startsWith(route + "/") || pathname === route;
  });
}

// 检查是否是静态资源
function isStaticResource(pathname: string): boolean {
  return (
    pathname.includes(".") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 跳过静态资源
  if (isStaticResource(pathname)) {
    return NextResponse.next();
  }

  // API 路由特殊处理
  if (pathname.startsWith("/api/")) {
    // 🔧 重要：OPTIONS 预检请求直接返回 CORS 头，不做认证检查
    // 这是为了支持从 ComfyUI 浏览器端的跨域请求
    if (request.method === "OPTIONS") {
      return new NextResponse(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "600",
        },
      });
    }

    // 允许公开的 API 路由（ComfyUI 回调端点不需要认证）
    if (
      pathname.startsWith("/api/auth") ||
      pathname.startsWith("/api/webhook") ||
      pathname === "/api/update-run" ||
      pathname === "/api/file-upload" ||
      pathname === "/api/machine-built"
    ) {
      return NextResponse.next();
    }

    // 允许模型下载任务状态更新（ComfyUI 回调，PATCH 请求）
    // 匹配 /api/volume/model/push/{task_id}
    if (
      request.method === "PATCH" &&
      /^\/api\/volume\/model\/push\/[a-f0-9-]+$/.test(pathname)
    ) {
      return NextResponse.next();
    }

    // 其他 API 路由检查 Bearer token（保持与原有 API key 系统兼容）
    const authHeader = request.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      // API 调用使用 Bearer token，让后续处理逻辑验证
      return NextResponse.next();
    }

    // 检查 session token
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET,
    });

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.next();
  }

  // 检查是否是公开路由
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // 检查用户认证
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET,
  });

  // 未登录用户重定向到登录页
  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
