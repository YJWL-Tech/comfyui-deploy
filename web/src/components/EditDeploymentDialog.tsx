"use client";

import { callServerPromise } from "./callServerPromise";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createDeployments } from "@/server/curdDeploments";
import type { findAllDeployments } from "@/server/findAllRuns";
import type { getMachines } from "@/server/curdMachine";
import { getMachineGroups } from "@/server/curdMachineGroup";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";

export function EditDeploymentDialog({
  deployment,
  machines,
  machineGroups,
}: {
  deployment: Awaited<ReturnType<typeof findAllDeployments>>[0];
  machines: Awaited<ReturnType<typeof getMachines>>;
  machineGroups: Awaited<ReturnType<typeof getMachineGroups>>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<string>(
    deployment.machine_id || "",
  );
  const [selectedGroup, setSelectedGroup] = useState<string>(
    deployment.machine_group_id || "",
  );
  const [useGroup, setUseGroup] = useState(!!deployment.machine_group_id);
  const [isLoading, setIsLoading] = useState(false);

  // Staging环境只能使用machine
  const canUseGroup = deployment.environment !== "staging";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Deployment</DialogTitle>
          <DialogDescription>
            Update machine or machine group for this deployment
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="flex items-center space-x-2">
              <input
                type="radio"
                checked={!useGroup}
                onChange={() => {
                  setUseGroup(false);
                  setSelectedGroup("");
                }}
                disabled={!canUseGroup && deployment.environment === "staging"}
              />
              <span>Use Single Machine</span>
            </label>
            {!useGroup && (
              <Select
                value={selectedMachine}
                onValueChange={setSelectedMachine}
                className="mt-2"
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a machine" />
                </SelectTrigger>
                <SelectContent>
                  {machines?.map((m) => (
                    <SelectItem key={m.id} value={m.id ?? ""}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {canUseGroup && machineGroups && machineGroups.length > 0 && (
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  checked={useGroup}
                  onChange={() => {
                    setUseGroup(true);
                    setSelectedMachine("");
                  }}
                />
                <span>Use Machine Group</span>
              </label>
              {useGroup && (
                <Select
                  value={selectedGroup}
                  onValueChange={setSelectedGroup}
                  className="mt-2"
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a machine group" />
                  </SelectTrigger>
                  <SelectContent>
                    {machineGroups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name} ({g.members.length} machines)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
          {!canUseGroup && (
            <p className="text-sm text-muted-foreground">
              Staging environment can only use a single machine
            </p>
          )}
          <Button
            onClick={async () => {
              if (useGroup && !selectedGroup) return;
              if (!useGroup && !selectedMachine) return;

              setIsLoading(true);
              await callServerPromise(
                createDeployments(
                  deployment.workflow_id,
                  deployment.workflow_version_id,
                  useGroup ? null : selectedMachine,
                  useGroup ? selectedGroup : null,
                  deployment.environment,
                ),
              );
              setIsLoading(false);
              setOpen(false);
            }}
            disabled={
              isLoading ||
              (useGroup ? !selectedGroup : !selectedMachine) ||
              (useGroup && selectedGroup === deployment.machine_group_id) ||
              (!useGroup && selectedMachine === deployment.machine_id)
            }
          >
            {isLoading ? "Updating..." : "Update Deployment"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

