import { NextRequest, NextResponse } from "next/server";

/**
 * Mock Webhook 端点
 * 用于测试 webhook 通知功能
 * 接收任何请求并返回相同的内容（echo）
 * 
 * 访问: POST /api/webhook
 * 或: GET /api/webhook?test=value
 */
export async function POST(request: NextRequest) {
    try {
        // 获取请求头
        const headers: Record<string, string> = {};
        request.headers.forEach((value, key) => {
            headers[key] = value;
        });

        // 获取请求体
        let body: any;
        const contentType = request.headers.get("content-type") || "";

        try {
            if (contentType.includes("application/json")) {
                body = await request.json();
            } else if (contentType.includes("application/x-www-form-urlencoded")) {
                const formData = await request.formData();
                body = Object.fromEntries(formData.entries());
            } else if (contentType.includes("multipart/form-data")) {
                const formData = await request.formData();
                body = Object.fromEntries(formData.entries());
            } else {
                const text = await request.text();
                // 尝试解析为 JSON
                try {
                    body = JSON.parse(text);
                } catch {
                    body = text;
                }
            }
        } catch (error) {
            console.warn("[MOCK WEBHOOK] Error parsing body:", error);
            body = null;
        }

        // 获取查询参数
        const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());

        // 记录请求信息
        console.log("=".repeat(60));
        console.log("📥 [MOCK WEBHOOK] Received POST request");
        console.log("=".repeat(60));
        console.log("Method: POST");
        console.log("URL:", request.url);
        console.log("Content-Type:", contentType);
        console.log("Headers:", JSON.stringify(headers, null, 2));
        if (Object.keys(searchParams).length > 0) {
            console.log("Query Params:", JSON.stringify(searchParams, null, 2));
        }
        console.log("Body:", body !== null ? JSON.stringify(body, null, 2) : "null/empty");
        console.log("=".repeat(60));

        // 返回请求的所有信息（echo）
        return NextResponse.json(
            {
                success: true,
                message: "Mock webhook received - echo response",
                timestamp: new Date().toISOString(),
                echo: {
                    method: "POST",
                    url: request.url,
                    headers,
                    query: searchParams,
                    body,
                },
            },
            {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                },
            }
        );
    } catch (error) {
        console.error("[MOCK WEBHOOK] Error:", error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
                timestamp: new Date().toISOString(),
            },
            {
                status: 500,
            }
        );
    }
}

/**
 * 支持 GET 请求（用于测试）
 */
export async function GET(request: NextRequest) {
    const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());

    // 获取请求头
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
        headers[key] = value;
    });

    console.log("=".repeat(60));
    console.log("📥 [MOCK WEBHOOK] Received GET request");
    console.log("=".repeat(60));
    console.log("Method: GET");
    console.log("URL:", request.url);
    console.log("Headers:", JSON.stringify(headers, null, 2));
    if (Object.keys(searchParams).length > 0) {
        console.log("Query Params:", JSON.stringify(searchParams, null, 2));
    }
    console.log("=".repeat(60));

    return NextResponse.json(
        {
            success: true,
            message: "Mock webhook GET endpoint - echo response",
            timestamp: new Date().toISOString(),
            echo: {
                method: "GET",
                url: request.url,
                headers,
                query: searchParams,
            },
        },
        {
            status: 200,
        }
    );
}

/**
 * 支持 PUT 请求
 */
export async function PUT(request: NextRequest) {
    return handleRequest(request, "PUT");
}

/**
 * 支持 PATCH 请求
 */
export async function PATCH(request: NextRequest) {
    return handleRequest(request, "PATCH");
}

/**
 * 支持 DELETE 请求
 */
export async function DELETE(request: NextRequest) {
    return handleRequest(request, "DELETE");
}

/**
 * 通用请求处理函数
 */
async function handleRequest(request: NextRequest, method: string) {
    try {
        const headers: Record<string, string> = {};
        request.headers.forEach((value, key) => {
            headers[key] = value;
        });

        let body: any = null;
        const contentType = request.headers.get("content-type") || "";

        try {
            if (contentType.includes("application/json")) {
                body = await request.json();
            } else {
                const text = await request.text();
                try {
                    body = JSON.parse(text);
                } catch {
                    body = text;
                }
            }
        } catch (error) {
            console.warn(`[MOCK WEBHOOK] Error parsing body for ${method}:`, error);
        }

        const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries());

        console.log("=".repeat(60));
        console.log(`📥 [MOCK WEBHOOK] Received ${method} request`);
        console.log("=".repeat(60));
        console.log("Method:", method);
        console.log("URL:", request.url);
        console.log("Headers:", JSON.stringify(headers, null, 2));
        if (Object.keys(searchParams).length > 0) {
            console.log("Query Params:", JSON.stringify(searchParams, null, 2));
        }
        if (body !== null) {
            console.log("Body:", JSON.stringify(body, null, 2));
        }
        console.log("=".repeat(60));

        return NextResponse.json(
            {
                success: true,
                message: `Mock webhook ${method} endpoint - echo response`,
                timestamp: new Date().toISOString(),
                echo: {
                    method,
                    url: request.url,
                    headers,
                    query: searchParams,
                    body,
                },
            },
            {
                status: 200,
            }
        );
    } catch (error) {
        console.error(`[MOCK WEBHOOK] Error handling ${method}:`, error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
                timestamp: new Date().toISOString(),
            },
            {
                status: 500,
            }
        );
    }
}

