"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Send, Loader2, Server, Layers } from "lucide-react";
import { toast } from "sonner";
import { getMachines } from "@/server/curdMachine";
import { getMachineGroups } from "@/server/curdMachineGroup";
import { pushModelsToMachines } from "@/app/(app)/models/push/actions";
import type { MachineType, MachineGroupType } from "@/db/schema";

interface ModelPushDialogProps {
  selectedModelIds: string[];
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

export function ModelPushDialog({
  selectedModelIds,
  trigger,
  onSuccess,
}: ModelPushDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [machines, setMachines] = useState<MachineType[]>([]);
  const [machineGroups, setMachineGroups] = useState<MachineGroupType[]>([]);
  const [selectedMachineIds, setSelectedMachineIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [targetType, setTargetType] = useState<"machines" | "groups">("machines");

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open]);

  const loadData = async () => {
    try {
      const [machinesData, groupsData] = await Promise.all([
        getMachines(),
        getMachineGroups(),
      ]);
      setMachines(machinesData);
      setMachineGroups(groupsData);
    } catch (error) {
      console.error("Error loading data:", error);
      toast.error("加载机器列表失败");
    }
  };

  const handlePush = async () => {
    if (selectedModelIds.length === 0) {
      toast.error("请先选择要推送的模型");
      return;
    }

    if (
      targetType === "machines" &&
      selectedMachineIds.length === 0
    ) {
      toast.error("请选择至少一个目标机器");
      return;
    }

    if (targetType === "groups" && selectedGroupIds.length === 0) {
      toast.error("请选择至少一个机器组");
      return;
    }

    try {
      setLoading(true);
      const result = await pushModelsToMachines({
        model_ids: selectedModelIds,
        machine_ids: targetType === "machines" ? selectedMachineIds : undefined,
        machine_group_ids: targetType === "groups" ? selectedGroupIds : undefined,
      });

      toast.success(result.message);
      setOpen(false);
      setSelectedMachineIds([]);
      setSelectedGroupIds([]);
      onSuccess?.();
    } catch (error) {
      console.error("Error pushing models:", error);
      toast.error(error instanceof Error ? error.message : "推送失败");
    } finally {
      setLoading(false);
    }
  };

  const toggleMachine = (machineId: string) => {
    setSelectedMachineIds((prev) =>
      prev.includes(machineId)
        ? prev.filter((id) => id !== machineId)
        : [...prev, machineId]
    );
  };

  const toggleGroup = (groupId: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId]
    );
  };

  const selectAllMachines = () => {
    if (selectedMachineIds.length === machines.length) {
      setSelectedMachineIds([]);
    } else {
      setSelectedMachineIds(machines.map((m) => m.id));
    }
  };

  const selectAllGroups = () => {
    if (selectedGroupIds.length === machineGroups.length) {
      setSelectedGroupIds([]);
    } else {
      setSelectedGroupIds(machineGroups.map((g) => g.id));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button disabled={selectedModelIds.length === 0}>
            <Send className="h-4 w-4 mr-2" />
            推送模型
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>推送模型到机器</DialogTitle>
          <DialogDescription>
            将选中的 {selectedModelIds.length} 个模型推送到目标机器或机器组
          </DialogDescription>
        </DialogHeader>

        <Tabs value={targetType} onValueChange={(v) => setTargetType(v as any)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="machines">
              <Server className="h-4 w-4 mr-2" />
              单个机器
            </TabsTrigger>
            <TabsTrigger value="groups">
              <Layers className="h-4 w-4 mr-2" />
              机器组
            </TabsTrigger>
          </TabsList>

          <TabsContent value="machines" className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>选择目标机器</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={selectAllMachines}
              >
                {selectedMachineIds.length === machines.length
                  ? "取消全选"
                  : "全选"}
              </Button>
            </div>
            <ScrollArea className="h-[300px] border rounded-md p-4">
              {machines.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  <Server className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>没有可用的机器</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {machines.map((machine) => (
                    <Card
                      key={machine.id}
                      className={`transition-colors ${
                        selectedMachineIds.includes(machine.id)
                          ? "border-primary bg-primary/5"
                          : ""
                      }`}
                    >
                      <CardContent className="p-4 flex items-center justify-between">
                        <div 
                          className="flex items-center space-x-3 flex-1 cursor-pointer hover:opacity-80"
                          onClick={() => toggleMachine(machine.id)}
                        >
                          <Checkbox
                            checked={selectedMachineIds.includes(machine.id)}
                            onCheckedChange={(checked) => {
                              toggleMachine(machine.id);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="flex-1">
                            <div className="font-medium">{machine.name}</div>
                            <div className="text-sm text-muted-foreground truncate max-w-[400px]">
                              {machine.endpoint}
                            </div>
                          </div>
                        </div>
                        {machine.status && (
                          <Badge
                            variant={
                              machine.status === "ready" ? "success" : "secondary"
                            }
                          >
                            {machine.status}
                          </Badge>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
            <div className="text-sm text-muted-foreground">
              已选择 {selectedMachineIds.length} 台机器
            </div>
          </TabsContent>

          <TabsContent value="groups" className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>选择机器组</Label>
              <Button variant="outline" size="sm" onClick={selectAllGroups}>
                {selectedGroupIds.length === machineGroups.length
                  ? "取消全选"
                  : "全选"}
              </Button>
            </div>
            <ScrollArea className="h-[300px] border rounded-md p-4">
              {machineGroups.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  <Layers className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>没有可用的机器组</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {machineGroups.map((group) => (
                    <Card
                      key={group.id}
                      className={`transition-colors ${
                        selectedGroupIds.includes(group.id)
                          ? "border-primary bg-primary/5"
                          : ""
                      }`}
                    >
                      <CardContent className="p-4 flex items-center justify-between">
                        <div 
                          className="flex items-center space-x-3 flex-1 cursor-pointer hover:opacity-80"
                          onClick={() => toggleGroup(group.id)}
                        >
                          <Checkbox
                            checked={selectedGroupIds.includes(group.id)}
                            onCheckedChange={(checked) => {
                              toggleGroup(group.id);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="flex-1">
                            <div className="font-medium">{group.name}</div>
                            {group.description && (
                              <div className="text-sm text-muted-foreground">
                                {group.description}
                              </div>
                            )}
                            <div className="text-xs text-muted-foreground mt-1">
                              {group.members?.length || 0} 台机器
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
            <div className="text-sm text-muted-foreground">
              已选择 {selectedGroupIds.length} 个机器组
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={handlePush} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            开始推送
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

