import { db } from "@/db/db";
import {
  deploymentsTable,
  workflowTable,
  workflowVersionTable,
} from "@/db/schema";
import { APIKeyUserType } from "@/server/APIKeyBodyRequest";
import { auth } from "@clerk/nextjs";
import { and, desc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";

export async function getAllUserWorkflow() {
  const { userId, orgId } = await auth();

  if (!userId) {
    return null;
  }

  const workflow = await db.query.workflowTable.findMany({
    with: {
      user: {
        columns: {
          name: true,
        },
      },
      versions: {
        limit: 1,
        orderBy: desc(workflowVersionTable.version),
        columns: {
          id: true,
          version: true,
        },
      },
      deployments: {
        limit: 1,
        where: eq(deploymentsTable.environment, "public-share"),
        columns: {
          id: true,
        },
      },
    },
    columns: {
      id: true,
      updated_at: true,
      name: true,
    },
    orderBy: desc(workflowTable.updated_at),
    where:
      orgId != undefined
        ? eq(workflowTable.org_id, orgId)
        : and(eq(workflowTable.user_id, userId), isNull(workflowTable.org_id)),
  });

  return workflow;
}

export async function getWorkflowVersion(
  apiUser: APIKeyUserType,
  version_id: string,
) {
  const { org_id, user_id } = apiUser;

  if (!user_id) {
    throw new Error("No user id");
  }

  const parentWorkflow = await db.query.workflowTable.findFirst({
    where:
      org_id != undefined
        ? eq(workflowTable.org_id, org_id)
        : and(eq(workflowTable.user_id, user_id), isNull(workflowTable.org_id)),
  });

  if (!parentWorkflow) {
    throw new Error("No workflow found");
  }

  return db.query.workflowVersionTable.findFirst({
    where: eq(workflowVersionTable.id, version_id),
  });
}

export async function getWorkflowVersions(
  workflow_id: string,
  limit: number = 20,
  offset: number = 0,
) {
  // Get workflow versions with pagination (no permission check)
  return db.query.workflowVersionTable.findMany({
    where: eq(workflowVersionTable.workflow_id, workflow_id),
    orderBy: desc(workflowVersionTable.version),
    limit: limit,
    offset: offset,
    columns: {
      id: true,
      workflow_id: true,
      version: true,
      created_at: true,
      updated_at: true,
      // Exclude large fields for list view
      workflow: false,
      workflow_api: false,
      snapshot: false,
    },
  });
}
