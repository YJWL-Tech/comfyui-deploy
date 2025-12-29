"use server";

import { getMachineById } from "@/server/curdMachine";
import { auth } from "@/lib/auth";
import jwt from "jsonwebtoken";
import { getOrgOrUserDisplayName } from "@/server/getOrgOrUserDisplayName";
import { withServerPromise } from "@/server/withServerPromise";
import "server-only";
import { headers } from "next/headers";

export const editWorkflowOnMachine = withServerPromise(
  async (workflow_version_id: string, machine_id: string) => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[editWorkflowOnMachine] 🚀 User clicked Edit Workflow`);
    console.log(`[editWorkflowOnMachine] 📥 Input Parameters:`);
    console.log(`[editWorkflowOnMachine]    - workflow_version_id: ${workflow_version_id}`);
    console.log(`[editWorkflowOnMachine]    - machine_id: ${machine_id}`);

    const { userId, orgId } = await auth();
    console.log(`[editWorkflowOnMachine] 🔐 Auth Info:`);
    console.log(`[editWorkflowOnMachine]    - userId: ${userId}`);
    console.log(`[editWorkflowOnMachine]    - orgId: ${orgId}`);

    // 优先级：EDIT_ORIGIN_URL > API_URL > 请求头
    // EDIT_ORIGIN_URL: 专门用于 Edit Workflow，必须是浏览器可访问的公网地址
    // API_URL: 通用 API 地址，可能是内网地址（用于服务器端回调）
    let domain: string;
    if (process.env.EDIT_ORIGIN_URL) {
      domain = process.env.EDIT_ORIGIN_URL.replace(/\/$/, "");
      console.log(`[editWorkflowOnMachine] 🌐 Domain (from EDIT_ORIGIN_URL env - highest priority): ${domain}`);
    } else if (process.env.API_URL) {
      domain = process.env.API_URL.replace(/\/$/, "");
      console.log(`[editWorkflowOnMachine] 🌐 Domain (from API_URL env): ${domain}`);
    } else {
      const headersList = headers();
      const host = headersList.get("host") || "";
      const protocol = headersList.get("x-forwarded-proto") || "";
      domain = `${protocol}://${host}`;
      console.log(`[editWorkflowOnMachine] 🌐 Domain (from headers):`);
      console.log(`[editWorkflowOnMachine]    - host: ${host}`);
      console.log(`[editWorkflowOnMachine]    - protocol: ${protocol}`);
      console.log(`[editWorkflowOnMachine]    - domain: ${domain}`);
    }
    console.log(`[editWorkflowOnMachine] 🔧 Environment Check:`);
    console.log(`[editWorkflowOnMachine]    - EDIT_ORIGIN_URL: ${process.env.EDIT_ORIGIN_URL || '(not set)'}`);
    console.log(`[editWorkflowOnMachine]    - API_URL: ${process.env.API_URL || '(not set)'}`)

    if (!userId) {
      throw new Error("No user id");
    }

    const machine = await getMachineById(machine_id);
    console.log(`[editWorkflowOnMachine] 🖥️  Machine Info:`);
    console.log(`[editWorkflowOnMachine]    - machine.id: ${machine.id}`);
    console.log(`[editWorkflowOnMachine]    - machine.name: ${machine.name}`);
    console.log(`[editWorkflowOnMachine]    - machine.type: ${machine.type}`);
    console.log(`[editWorkflowOnMachine]    - machine.endpoint: ${machine.endpoint}`);

    const expireTime = "1w";
    const token = jwt.sign(
      { user_id: userId, org_id: orgId },
      process.env.JWT_SECRET!,
      {
        expiresIn: expireTime,
      },
    );

    const userName = await getOrgOrUserDisplayName(orgId, userId);
    console.log(`[editWorkflowOnMachine] 👤 User Display Name: ${userName}`);

    let endpoint = machine.endpoint;

    if (machine.type === "comfy-deploy-serverless") {
      endpoint = machine.endpoint.replace("comfyui-api", "comfyui-app");
      console.log(`[editWorkflowOnMachine] 🔄 Endpoint modified for serverless: ${endpoint}`);
    }

    const finalUrl = `${endpoint}?workflow_version_id=${encodeURIComponent(
      workflow_version_id,
    )}&auth_token=${encodeURIComponent(token)}&org_display=${encodeURIComponent(
      userName,
    )}&origin=${encodeURIComponent(domain)}`;

    console.log(`[editWorkflowOnMachine] 📤 Final URL Parameters:`);
    console.log(`[editWorkflowOnMachine]    - endpoint: ${endpoint}`);
    console.log(`[editWorkflowOnMachine]    - workflow_version_id: ${workflow_version_id}`);
    console.log(`[editWorkflowOnMachine]    - auth_token: ${token.substring(0, 50)}...`);
    console.log(`[editWorkflowOnMachine]    - org_display: ${userName}`);
    console.log(`[editWorkflowOnMachine]    - origin: ${domain}`);
    console.log(`[editWorkflowOnMachine] 🔗 Final URL: ${finalUrl}`);
    console.log(`${"=".repeat(60)}\n`);

    return finalUrl;
  },
);
