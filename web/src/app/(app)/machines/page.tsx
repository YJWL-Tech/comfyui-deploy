import { AccessType } from "../../../lib/AccessType";
import { MachineList } from "@/components/MachineList";
import { MachineGroupList } from "@/components/MachineGroupList";
import { db } from "@/db/db";
import { machinesTable } from "@/db/schema";
import { auth } from "@clerk/nextjs";
import { clerkClient } from "@clerk/nextjs/server";
import { desc, eq, isNull, and } from "drizzle-orm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getMachineGroups } from "@/server/curdMachineGroup";
import { getMachines } from "@/server/curdMachine";

export default function Page() {
  return <MachineListServer />;
}

async function MachineListServer() {
  const { userId, orgId } = await auth();

  if (!userId) {
    return <div>No auth</div>;
  }

  const user = await clerkClient.users.getUser(userId);

  const machines = await db.query.machinesTable.findMany({
    orderBy: desc(machinesTable.updated_at),
    where:
      orgId != undefined
        ? eq(machinesTable.org_id, orgId)
        : and(eq(machinesTable.user_id, userId), isNull(machinesTable.org_id)),
  });

  const groups = await getMachineGroups();
  const allMachines = await getMachines();

  return (
    <div className="w-full">
      <Tabs defaultValue="machines" className="w-full">
        <TabsList>
          <TabsTrigger value="machines">Machines</TabsTrigger>
          <TabsTrigger value="groups">Machine Groups</TabsTrigger>
        </TabsList>
        <TabsContent value="machines">
          <MachineList
            data={machines}
            userMetadata={AccessType.parse(user.privateMetadata ?? {})}
          />
        </TabsContent>
        <TabsContent value="groups">
          <MachineGroupList groups={groups} machines={allMachines} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
