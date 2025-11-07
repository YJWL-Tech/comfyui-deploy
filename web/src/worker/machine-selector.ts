import type { MachineType } from "@/db/schema";

export type LoadBalancerStrategy = "round-robin" | "least-load";

let roundRobinIndex = 0;

export async function selectMachine(
    machines: MachineType[],
    strategy: LoadBalancerStrategy = "least-load",
): Promise<MachineType | null> {
    // 过滤可用机器
    const availableMachines = machines.filter(
        (m) =>
            !m.disabled &&
            m.status === "ready" &&
            (m.operational_status === "idle" ||
                m.current_queue_size < m.allow_comfyui_queue_size),
    );

    if (availableMachines.length === 0) {
        return null;
    }

    switch (strategy) {
        case "round-robin":
            const selected =
                availableMachines[roundRobinIndex % availableMachines.length];
            roundRobinIndex++;
            return selected;

        case "least-load":
            // 选择队列大小最小的机器
            return availableMachines.reduce((prev, curr) =>
                curr.current_queue_size < prev.current_queue_size ? curr : prev,
            );

        default:
            return availableMachines[0];
    }
}

