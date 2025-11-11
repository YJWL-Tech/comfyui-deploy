import { auth } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { ModelPushTasks } from "@/components/ModelPushTasks";

export default async function ModelPushPage() {
    const { userId } = await auth();

    if (!userId) {
        redirect("/sign-in");
    }

    return (
        <div className="container mx-auto py-8">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">模型推送任务</h1>
                <p className="text-muted-foreground mt-2">
                    查看和管理模型推送到机器的任务状态
                </p>
            </div>
            <ModelPushTasks />
        </div>
    );
}

