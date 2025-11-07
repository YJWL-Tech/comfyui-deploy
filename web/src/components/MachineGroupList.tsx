"use client";

import { callServerPromise } from "./callServerPromise";
import { LoadingIcon } from "@/components/LoadingIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  createMachineGroup,
  deleteMachineGroup,
  updateMachineGroup,
  addMachineToGroup,
  removeMachineFromGroup,
} from "@/server/curdMachineGroup";
import { createMachineGroupSchema } from "@/server/addMachineGroupSchema";
import type { MachineType } from "@/db/schema";
import { MoreHorizontal, Plus, Trash2, Users } from "lucide-react";
import * as React from "react";
import { useState } from "react";
import type { z } from "zod";
import { getMachineGroups } from "@/server/curdMachineGroup";
import { getMachines } from "@/server/curdMachine";
import { useRouter } from "next/navigation";

type MachineGroup = Awaited<ReturnType<typeof getMachineGroups>>[0];

export function MachineGroupList({
  groups: initialGroups,
  machines,
}: {
  groups: Awaited<ReturnType<typeof getMachineGroups>>;
  machines: Awaited<ReturnType<typeof getMachines>>;
}) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [selectedGroup, setSelectedGroup] = useState<MachineGroup | null>(
    null,
  );
  const [addMachineOpen, setAddMachineOpen] = useState(false);
  const [selectedMachineId, setSelectedMachineId] = useState<string>("");

  // 当initialGroups变化时更新本地状态
  React.useEffect(() => {
    setGroups(initialGroups);
    // 如果当前选中的group存在，更新它
    if (selectedGroup) {
      const updatedGroup = initialGroups.find((g) => g.id === selectedGroup.id);
      if (updatedGroup) {
        setSelectedGroup(updatedGroup);
      }
    }
  }, [initialGroups]);

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Machine Groups</h2>
        <CreateMachineGroupDialog />
      </div>

      <ScrollArea className="rounded-md border w-full">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Machines</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  No machine groups. Create one to get started.
                </TableCell>
              </TableRow>
            ) : (
              groups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell className="font-medium">{group.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {group.description || "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      <span>{group.members.length} machines</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">Open menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem
                          onClick={() => setSelectedGroup(group)}
                        >
                          Manage Machines
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setSelectedGroup(group);
                            setAddMachineOpen(true);
                          }}
                        >
                          Add Machine
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={async () => {
                            await callServerPromise(
                              deleteMachineGroup(group.id),
                            );
                          }}
                        >
                          Delete Group
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* Manage Machines Dialog */}
      {selectedGroup && (
        <ManageGroupMachinesDialog
          group={selectedGroup}
          machines={machines}
          open={selectedGroup !== null}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedGroup(null);
            }
          }}
          onUpdate={() => {
            router.refresh();
          }}
        />
      )}

      {/* Add Machine Dialog */}
      {selectedGroup && (
        <Dialog open={addMachineOpen} onOpenChange={setAddMachineOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Machine to Group</DialogTitle>
              <DialogDescription>
                Select a machine to add to {selectedGroup.name}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Machine</Label>
                <Select
                  value={selectedMachineId}
                  onValueChange={setSelectedMachineId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a machine" />
                  </SelectTrigger>
                  <SelectContent>
                    {machines
                      .filter(
                        (m) =>
                          !selectedGroup.members.some(
                            (member) => member.machine_id === m.id,
                          ),
                      )
                      .map((machine) => (
                        <SelectItem key={machine.id} value={machine.id}>
                          {machine.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={async () => {
                  if (!selectedMachineId) return;
                  await callServerPromise(
                    addMachineToGroup({
                      group_id: selectedGroup.id,
                      machine_id: selectedMachineId,
                    }),
                  );
                  setAddMachineOpen(false);
                  setSelectedMachineId("");
                  // 更新本地状态
                  const addedMachine = machines.find(
                    (m) => m.id === selectedMachineId,
                  );
                  if (addedMachine && selectedGroup) {
                    setSelectedGroup({
                      ...selectedGroup,
                      members: [
                        ...selectedGroup.members,
                        { machine_id: selectedMachineId, machine: addedMachine },
                      ],
                    });
                  }
                  // 刷新页面数据
                  router.refresh();
                }}
              >
                Add Machine
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function CreateMachineGroupDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create Group
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Machine Group</DialogTitle>
          <DialogDescription>
            Create a new machine group to manage multiple machines together.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., GPU Cluster A"
            />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          <Button
            onClick={async () => {
              await callServerPromise(
                createMachineGroup({
                  name,
                  description: description || undefined,
                }),
              );
              setOpen(false);
              setName("");
              setDescription("");
            }}
            disabled={!name}
          >
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ManageGroupMachinesDialog({
  group: initialGroup,
  machines,
  open,
  onOpenChange,
  onUpdate,
}: {
  group: MachineGroup;
  machines: Awaited<ReturnType<typeof getMachines>>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate?: () => void;
}) {
  const router = useRouter();
  const [group, setGroup] = useState(initialGroup);

  // 当initialGroup变化时更新本地状态
  React.useEffect(() => {
    setGroup(initialGroup);
  }, [initialGroup]);

  const groupMachines = machines.filter((m) =>
    group.members.some((member) => member.machine_id === m.id),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage Machines in {group.name}</DialogTitle>
          <DialogDescription>
            Add or remove machines from this group
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[400px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Machine Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupMachines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-24 text-center">
                    No machines in this group
                  </TableCell>
                </TableRow>
              ) : (
                groupMachines.map((machine) => (
                  <TableRow key={machine.id}>
                    <TableCell className="font-medium">{machine.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          machine.status === "ready" ? "success" : "destructive"
                        }
                        className="capitalize"
                      >
                        {machine.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          await callServerPromise(
                            removeMachineFromGroup({
                              group_id: group.id,
                              machine_id: machine.id,
                            }),
                          );
                          // 更新本地状态
                          setGroup({
                            ...group,
                            members: group.members.filter(
                              (m) => m.machine_id !== machine.id,
                            ),
                          });
                          // 刷新页面数据
                          router.refresh();
                          onUpdate?.();
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

