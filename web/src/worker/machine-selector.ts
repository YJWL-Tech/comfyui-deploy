import type { MachineType } from "@/db/schema";

export type LoadBalancerStrategy = "round-robin" | "least-load";

const MACHINE_SELECTOR_LOG =
    (typeof process !== "undefined" && process.env?.LOG_MACHINE_SELECTOR === "true") || false;

let roundRobinIndex = 0;

function machineUnavailableReason(m: MachineType): string {
    if (m.disabled) return "disabled";
    if (m.status !== "ready") return `status=${m.status}`;
    const cap = m.allow_comfyui_queue_size ?? 0;
    if (m.current_queue_size >= cap) return `queue_full(${m.current_queue_size}/${cap})`;
    if (m.operational_status !== "idle" && m.current_queue_size >= cap) return `busy(${m.current_queue_size}/${cap})`;
    return "ok";
}

export async function selectMachine(
    machines: MachineType[],
    strategy: LoadBalancerStrategy = "least-load",
): Promise<MachineType | null> {
    // 过滤可用机器：未禁用、status=ready、且（空闲 或 队列未满）
    const availableMachines = machines.filter(
        (m) =>
            !m.disabled &&
            m.status === "ready" &&
            (m.operational_status === "idle" ||
                m.current_queue_size < m.allow_comfyui_queue_size),
    );

    if (MACHINE_SELECTOR_LOG || availableMachines.length === 0) {
        for (const m of machines) {
            const reason = machineUnavailableReason(m);
            console.log(
                `[MachineSelector] ${m.name} (${m.id}): status=${m.status}, disabled=${m.disabled}, ` +
                    `queue=${m.current_queue_size}/${m.allow_comfyui_queue_size}, op=${m.operational_status} => ${reason}`
            );
        }
        console.log(
            `[MachineSelector] Available: ${availableMachines.length}/${machines.length}, strategy=${strategy}`
        );
    }

    if (availableMachines.length === 0) {
        return null;
    }

    switch (strategy) {
        case "round-robin": {
            const selected =
                availableMachines[roundRobinIndex % availableMachines.length];
            roundRobinIndex++;
            if (MACHINE_SELECTOR_LOG) {
                console.log(`[MachineSelector] Selected (round-robin): ${selected.name} index=${roundRobinIndex - 1}`);
            }
            return selected;
        }

        case "least-load": {
            const selected = availableMachines.reduce((prev, curr) =>
                curr.current_queue_size < prev.current_queue_size ? curr : prev,
            );
            if (MACHINE_SELECTOR_LOG) {
                console.log(`[MachineSelector] Selected (least-load): ${selected.name} queue=${selected.current_queue_size}`);
            }
            return selected;
        }

        default:
            if (MACHINE_SELECTOR_LOG) {
                console.log(`[MachineSelector] Selected (default): ${availableMachines[0].name}`);
            }
            return availableMachines[0];
    }
}

