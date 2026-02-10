import { db } from "@/db/db";
import { machinesTable } from "@/db/schema";
import { eq, sql, and, lte } from "drizzle-orm";

/** 设为 "true" 时打印队列增减日志，便于排查机器不可用 */
const LOG_QUEUE_OPS = process.env.LOG_MACHINE_QUEUE === "true";

/**
 * 原子性地增加机器队列计数（带限制检查）
 * 返回是否成功增加（如果队列已满则返回false）
 */
export async function incrementMachineQueue(
    machineId: string,
    maxQueueSize?: number
): Promise<boolean> {
    if (maxQueueSize !== undefined) {
        // 原子性地检查并更新：只在队列未满时增加
        const result = await db
            .update(machinesTable)
            .set({
                current_queue_size: sql`${machinesTable.current_queue_size} + 1`,
                operational_status: "busy",
            })
            .where(
                and(
                    eq(machinesTable.id, machineId),
                    lte(machinesTable.current_queue_size, maxQueueSize - 1)
                )
            )
            .returning({ updated_queue_size: machinesTable.current_queue_size });

        const ok = result.length > 0;
        if (LOG_QUEUE_OPS) {
            console.log(
                `[MachineQueue] increment machine=${machineId} maxQueue=${maxQueueSize} => ${ok ? `newSize=${result[0]?.updated_queue_size}` : "rejected (queue full)"}`
            );
        }
        return ok;
    } else {
        // 无限制，直接增加
        await db
            .update(machinesTable)
            .set({
                current_queue_size: sql`${machinesTable.current_queue_size} + 1`,
                operational_status: "busy",
            })
            .where(eq(machinesTable.id, machineId));
        if (LOG_QUEUE_OPS) console.log(`[MachineQueue] increment machine=${machineId} (no limit)`);
        return true;
    }
}

export async function decrementMachineQueue(machineId: string) {
    const result = await db
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
        .where(eq(machinesTable.id, machineId))
        .returning({ current_queue_size: machinesTable.current_queue_size, name: machinesTable.name });

    if (LOG_QUEUE_OPS && result[0]) {
        console.log(
            `[MachineQueue] decrement machine=${machineId} (${result[0].name}) => queue=${result[0].current_queue_size}`
        );
    }
}

export async function syncMachineQueueSize(
    machineId: string,
    actualSize: number,
) {
    const result = await db
        .update(machinesTable)
        .set({
            current_queue_size: actualSize,
            operational_status: actualSize > 0 ? "busy" : "idle",
        })
        .where(eq(machinesTable.id, machineId))
        .returning({ name: machinesTable.name, current_queue_size: machinesTable.current_queue_size });

    if (LOG_QUEUE_OPS && result[0]) {
        console.log(
            `[MachineQueue] sync machine=${machineId} (${result[0].name}) => queue=${result[0].current_queue_size}`
        );
    }
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

