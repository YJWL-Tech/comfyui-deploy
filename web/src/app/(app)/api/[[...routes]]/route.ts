import { registerCreateRunRoute } from "@/routes/registerCreateRunRoute";
import { registerGetOutputRoute } from "@/routes/registerGetOutputRoute";
import { registerUploadRoute } from "@/routes/registerUploadRoute";
import { isKeyRevoked } from "@/server/curdApiKeys";
import { parseJWT } from "@/server/parseJWT";
import type { Context, Next } from "hono";
import { handle } from "hono/vercel";
import { app } from "../../../../routes/app";
import { registerWorkflowUploadRoute } from "@/routes/registerWorkflowUploadRoute";
import { registerWorkflowVersionRoute } from "@/routes/registerWorkflowVersionRoute";
import { registerGetAuthResponse } from "@/routes/registerGetAuthResponse";
import { registerGetWorkflowRoute } from "@/routes/registerGetWorkflow";
import { registerQueueRoute, registerQueueStatusRoute } from "@/routes/registerQueueRoute";
import { registerQueueManagementRoute } from "@/routes/registerQueueManagementRoute";
import { registerVolumeRoute } from "@/routes/registerVolumeRoute";
import { registerModelPushRoute } from "@/routes/registerModelPushRoute";
import { registerFilesRoute } from "@/routes/registerFilesRoute";
import { registerDeploymentsRoute } from "@/routes/registerDeploymentsRoute";
import { cors } from "hono/cors";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes

// 自动初始化已禁用 - Worker 现在只在手动点击 "启动 Worker" 按钮时初始化

declare module "hono" {
  interface ContextVariableMap {
    apiKeyTokenData: ReturnType<typeof parseJWT>;
  }
}

async function checkAuth(c: Context, next: Next, headers?: HeadersInit) {
  const token = c.req.raw.headers.get("Authorization")?.split(" ")?.[1]; // Assuming token is sent as "Bearer your_token"
  const userData = token ? parseJWT(token) : undefined;
  if (!userData || token === undefined) {
    return c.text("Invalid or expired token", {
      status: 401,
      headers: headers,
    });
  }

  // If the key has expiration, this is a temporary key and not in our db, so we can skip checking
  if (userData.exp === undefined) {
    const revokedKey = await isKeyRevoked(token);
    if (revokedKey)
      return c.text("Revoked token", {
        status: 401,
        headers: headers,
      });
  }

  c.set("apiKeyTokenData", userData);

  await next();
}

app.use("/run", checkAuth);
app.use("/upload-url", checkAuth);
app.use("/queue/*", checkAuth);

const corsHandler = cors({
  origin: "*",
  allowHeaders: ["Authorization", "Content-Type"],
  allowMethods: ["POST", "GET", "OPTIONS", "PATCH", "DELETE"],
  exposeHeaders: ["Content-Length"],
  maxAge: 600,
  credentials: true,
});

// CORS Check
app.use("/workflow", corsHandler, checkAuth);
// workflow-version: CORS 先处理，然后对非 OPTIONS 请求进行认证
app.use("/workflow-version/*", corsHandler);
app.use("/workflow-version/*", async (c, next) => {
  // OPTIONS 预检请求跳过认证
  if (c.req.method === "OPTIONS") {
    return next();
  }
  return checkAuth(c, next);
});
app.use("/files/*", corsHandler, checkAuth);
app.use("/deployments", corsHandler, checkAuth);
app.use("/deployments/*", corsHandler, checkAuth);

// 排除 model push 状态更新接口（供 ComfyUI 机器调用）
// 必须在 CORS 之后，但在其他认证之前
app.use("/volume/*", corsHandler);
app.use("/volume/*", async (c, next) => {
  // 如果是更新任务状态的 PATCH 请求，跳过认证
  const method = c.req.method;
  const url = new URL(c.req.url);
  const pathname = url.pathname;

  // 匹配 /api/volume/model/push/{task_id} 或 /volume/model/push/{task_id} 的 PATCH 请求
  const isUpdateTaskStatus =
    method === "PATCH" &&
    (/\/volume\/model\/push\/[a-f0-9-]+$/.test(pathname) ||
      /\/api\/volume\/model\/push\/[a-f0-9-]+$/.test(pathname));

  if (isUpdateTaskStatus) {
    console.log(`[Auth Middleware] Skipping auth for PATCH ${pathname}`);
    // 跳过认证，直接继续
    await next();
    return;
  }
  // 其他 /volume/* 请求需要认证
  console.log(`[Auth Middleware] Requiring auth for ${method} ${pathname}`);
  await checkAuth(c, next);
});

// create run endpoint
registerCreateRunRoute(app);
registerGetOutputRoute(app);

// file upload endpoint
registerUploadRoute(app);

// Anon
registerGetAuthResponse(app);

registerWorkflowUploadRoute(app);
registerWorkflowVersionRoute(app);
registerGetWorkflowRoute(app);
registerQueueRoute(app);
registerQueueStatusRoute(app);
registerQueueManagementRoute(app);
registerVolumeRoute(app);
registerModelPushRoute(app);
registerFilesRoute(app);
registerDeploymentsRoute(app);

// The OpenAPI documentation will be available at /doc
app.doc("/doc", {
  openapi: "3.0.0",
  servers: [{ url: "/api" }],
  security: [{ bearerAuth: [] }],
  info: {
    version: "0.0.1",
    title: "Comfy Deploy API",
    description:
      "Interact with Comfy Deploy programmatically to trigger run and retrieve output",
  },
});

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "apiKey",
  bearerFormat: "JWT",
  in: "header",
  name: "Authorization",
  description:
    "API token created in Comfy Deploy <a href='/api-keys' target='_blank' style='text-decoration: underline;'>/api-keys</a>",
});

const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
export const OPTIONS = handler;
