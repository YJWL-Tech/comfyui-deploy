import { db } from "@/db/db";
import { machinesTable } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export async function incrementMachineQueue(machineId: string) {
    await db
        .update(machinesTable)
        .set({
            current_queue_size: sql`${machinesTable.current_queue_size} + 1`,
            operational_status: "busy",
        })
        .where(eq(machinesTable.id, machineId));
}

export async function decrementMachineQueue(machineId: string) {
    await db
        .update(machinesTable)
        .set({
            current_queue_size: sql`GREATEST(0, ${machinesTable.current_queue_size} - 1)`,
            operational_status: sql`
        CASE 
          WHEN ${machinesTable.current_queue_size} - 1 <= 0 THEN 'idle'
          ELSE 'busy'
        END
      `,
        })
        .where(eq(machinesTable.id, machineId));
}

export async function syncMachineQueueSize(
    machineId: string,
    actualSize: number,
) {
    await db
        .update(machinesTable)
        .set({
            current_queue_size: actualSize,
            operational_status: actualSize > 0 ? "busy" : "idle",
        })
        .where(eq(machinesTable.id, machineId));
}

export async function setMachineIdle(machineId: string) {
    await db
        .update(machinesTable)
        .set({
            operational_status: "idle",
            current_queue_size: 0,
        })
        .where(eq(machinesTable.id, machineId));
}

export async function setMachineBusy(machineId: string) {
    await db
        .update(machinesTable)
        .set({
            operational_status: "busy",
        })
        .where(eq(machinesTable.id, machineId));
}

