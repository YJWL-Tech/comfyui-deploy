"use server";

import { db } from "@/db/db";
import {
    machineGroupsTable,
    machineGroupMembersTable,
    machinesTable,
} from "@/db/schema";
import { auth } from "@clerk/nextjs";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import "server-only";
import { withServerPromise } from "./withServerPromise";
import { createMachineGroupSchema } from "./addMachineGroupSchema";
import type { z } from "zod";

export async function getMachineGroups() {
    const { userId, orgId } = auth();
    if (!userId) throw new Error("No user id");

    const groups = await db.query.machineGroupsTable.findMany({
        where: orgId
            ? eq(machineGroupsTable.org_id, orgId)
            : and(
                eq(machineGroupsTable.user_id, userId),
                isNull(machineGroupsTable.org_id),
            ),
        with: {
            members: {
                with: {
                    machine: true,
                },
            },
        },
        orderBy: (groups, { desc }) => [desc(groups.created_at)],
    });

    return groups;
}

export const createMachineGroup = withServerPromise(
    async (data: z.infer<typeof createMachineGroupSchema>) => {
        const { userId, orgId } = auth();
        if (!userId) throw new Error("No user id");

        await db.insert(machineGroupsTable).values({
            ...data,
            user_id: userId,
            org_id: orgId,
        });

        revalidatePath("/machines");
        return { message: "Machine group created" };
    },
);

export const updateMachineGroup = withServerPromise(
    async ({
        id,
        ...data
    }: z.infer<typeof createMachineGroupSchema> & { id: string }) => {
        const { userId } = auth();
        if (!userId) throw new Error("No user id");

        await db
            .update(machineGroupsTable)
            .set(data)
            .where(eq(machineGroupsTable.id, id));

        revalidatePath("/machines");
        return { message: "Machine group updated" };
    },
);

export const deleteMachineGroup = withServerPromise(
    async (group_id: string) => {
        const { userId } = auth();
        if (!userId) throw new Error("No user id");

        await db
            .delete(machineGroupsTable)
            .where(eq(machineGroupsTable.id, group_id));

        revalidatePath("/machines");
        return { message: "Machine group deleted" };
    },
);

export const addMachineToGroup = withServerPromise(
    async ({
        group_id,
        machine_id,
    }: {
        group_id: string;
        machine_id: string;
    }) => {
        const { userId } = auth();
        if (!userId) throw new Error("No user id");

        // Check if already exists
        const existing = await db.query.machineGroupMembersTable.findFirst({
            where: and(
                eq(machineGroupMembersTable.group_id, group_id),
                eq(machineGroupMembersTable.machine_id, machine_id),
            ),
        });

        if (existing) {
            return { message: "Machine already in group" };
        }

        await db.insert(machineGroupMembersTable).values({
            group_id,
            machine_id,
        });

        revalidatePath("/machines");
        return { message: "Machine added to group" };
    },
);

export const removeMachineFromGroup = withServerPromise(
    async ({
        group_id,
        machine_id,
    }: {
        group_id: string;
        machine_id: string;
    }) => {
        const { userId } = auth();
        if (!userId) throw new Error("No user id");

        await db
            .delete(machineGroupMembersTable)
            .where(
                and(
                    eq(machineGroupMembersTable.group_id, group_id),
                    eq(machineGroupMembersTable.machine_id, machine_id),
                ),
            );

        revalidatePath("/machines");
        return { message: "Machine removed from group" };
    },
);

export const updateMachineQueueSettings = withServerPromise(
    async ({
        machine_id,
        allow_comfyui_queue_size,
    }: {
        machine_id: string;
        allow_comfyui_queue_size: number;
    }) => {
        const { userId } = auth();
        if (!userId) throw new Error("No user id");

        await db
            .update(machinesTable)
            .set({
                allow_comfyui_queue_size,
            })
            .where(eq(machinesTable.id, machine_id));

        revalidatePath("/machines");
        return { message: "Machine queue settings updated" };
    },
);

export const syncMachineQueueFromComfyUI = withServerPromise(
    async (machine_id?: string) => {
        const { userId } = auth();
        if (!userId) throw new Error("No user id");

        const { syncSingleMachineQueue, syncAllMachinesQueue } = await import(
            "@/server/machine/syncMachineQueueFromComfyUI"
        );

        if (machine_id) {
            const result = await syncSingleMachineQueue(machine_id);
            revalidatePath("/machines");
            return result;
        } else {
            const result = await syncAllMachinesQueue();
            revalidatePath("/machines");
            return result;
        }
    },
);

