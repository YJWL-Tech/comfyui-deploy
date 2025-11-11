"use client";

import { getRelativeTime } from "../lib/getRelativeTime";
import { InsertModal, UpdateModal } from "./InsertModal";
import { callServerPromise } from "./callServerPromise";
import { LoadingIcon } from "@/components/LoadingIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type MachineType } from "@/db/schema";
import type { AccessType } from "@/lib/AccessType";
import {
  addCustomMachineSchema,
  addMachineSchema,
} from "@/server/addMachineSchema";
import {
  addCustomMachine,
  addMachine,
  buildMachine,
  deleteMachine,
  disableMachine,
  enableMachine,
  updateCustomMachine,
  updateMachine,
} from "@/server/curdMachine";
import { updateMachineQueueSettings, syncMachineQueueFromComfyUI } from "@/server/curdMachineGroup";
import type {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, MoreHorizontal, RefreshCw, RotateCw } from "lucide-react";
import * as React from "react";
import { useState } from "react";
import type { z } from "zod";
import { MachineRealtimeLogs } from "./MachineRealtimeLogs";

export type Machine = MachineType;

export const columns: ColumnDef<Machine>[] = [
  {
    accessorKey: "id",
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "name",
    header: ({ column }) => {
      return (
        <button
          className="flex items-center hover:underline"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Name
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </button>
      );
    },
    cell: ({ row }) => {
      return (
        // <a className="hover:underline" href={`/${row.original.id}`}>
        <div className="flex flex-row gap-2 items-center truncate">
          <a href={`/machines/${row.original.id}`} className="hover:underline">
            {row.getValue("name")}
          </a>
          {row.original.disabled && (
            <Badge variant="destructive">Disabled</Badge>
          )}
          {row.original.status == "building" && (
            <Badge variant="amber" className="capitalize">
              {row.original.status} <LoadingIcon />
            </Badge>
          )}
          {!row.original.disabled && row.original.status && (
            <Badge
              variant={
                row.original.status == "ready" ? "success" : "destructive"
              }
              className="capitalize"
            >
              {row.original.status}
            </Badge>
          )}
        </div>
        // </a>
      );
    },
  },
  {
    accessorKey: "endpoint",
    header: () => <div className="text-left">Endpoint</div>,
    cell: ({ row }) => {
      return (
        <div className="text-left font-medium truncate max-w-[400px]">
          {row.original.endpoint}
        </div>
      );
    },
  },
  {
    accessorKey: "type",
    header: () => <div className="text-left">Type</div>,
    cell: ({ row }) => {
      return (
        <div className="text-left font-medium truncate">
          {row.original.type}
        </div>
      );
    },
  },
  {
    accessorKey: "operational_status",
    header: () => <div className="text-left">Queue Status</div>,
    cell: ({ row }) => {
      const machine = row.original;
      const [syncing, setSyncing] = useState(false);

      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Badge
              variant={
                machine.operational_status === "idle" ? "success" : "amber"
              }
              className="w-fit capitalize"
            >
              {machine.operational_status}
            </Badge>
            {machine.type === "classic" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={async (e) => {
                  e.stopPropagation();
                  setSyncing(true);
                  try {
                    await callServerPromise(
                      syncMachineQueueFromComfyUI(machine.id)
                    );
                  } finally {
                    setSyncing(false);
                  }
                }}
                disabled={syncing}
                title="Sync queue status from ComfyUI"
              >
                <RotateCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
              </Button>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {machine.current_queue_size} / {machine.allow_comfyui_queue_size}
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "date",
    sortingFn: "datetime",
    enableSorting: true,
    header: ({ column }) => {
      return (
        <button
          className="w-full flex items-center justify-end hover:underline truncate"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Update Date
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </button>
      );
    },
    cell: ({ row }) => (
      <div className="capitalize text-right">
        {getRelativeTime(row.original.updated_at)}
      </div>
    ),
  },

  {
    id: "actions",
    enableHiding: false,
    cell: ({ row }) => {
      const machine = row.original;
      const [open, setOpen] = useState(false);
      const [queueSettingsOpen, setQueueSettingsOpen] = useState(false);

      return (
        <div className="flex items-center gap-2">
          {machine.type === "classic" && machine.endpoint && (
            <MachineRealtimeLogs
              machineId={machine.id}
              machineName={machine.name}
              endpoint={machine.endpoint}
            />
          )}
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
                className="text-destructive"
                onClick={async () => {
                  callServerPromise(deleteMachine(machine.id));
                }}
              >
                Delete Machine
              </DropdownMenuItem>
              {machine.disabled ? (
                <DropdownMenuItem
                  onClick={async () => {
                    callServerPromise(enableMachine(machine.id));
                  }}
                >
                  Enable Machine
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={async () => {
                    callServerPromise(disableMachine(machine.id));
                  }}
                >
                  Disable Machine
                </DropdownMenuItem>
              )}
              {machine.type === "comfy-deploy-serverless" && (
                <>
                  <DropdownMenuItem asChild>
                    <a
                      target="_blank"
                      href={machine.endpoint.replace(
                        "comfyui-api",
                        "comfyui-app"
                      )} rel="noreferrer"
                    >
                      Open ComfyUI
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      buildMachine({
                        id: machine.id,
                      });
                    }}
                  >
                    Rebuild
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem onClick={() => setOpen(true)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setQueueSettingsOpen(true)}>
                Queue Settings
              </DropdownMenuItem>
            </DropdownMenuContent>
            {machine.type === "comfy-deploy-serverless" ? (
              <UpdateModal
                dialogClassName="sm:max-w-[600px]"
                data={machine}
                open={open}
                setOpen={setOpen}
                title="Edit"
                description="Edit machines"
                serverAction={updateCustomMachine}
                formSchema={addCustomMachineSchema}
                fieldConfig={{
                  type: {
                    fieldType: "fallback",
                    inputProps: {
                      disabled: true,
                      showLabel: false,
                      type: "hidden",
                    },
                  },
                  snapshot: {
                    fieldType: "snapshot",
                  },
                  models: {
                    fieldType: "models",
                  },
                  gpu: {
                    inputProps: {},
                  },
                }}
              />
            ) : (
              <UpdateModal
                data={machine}
                open={open}
                setOpen={setOpen}
                title="Edit"
                description="Edit machines"
                serverAction={updateMachine}
                formSchema={addMachineSchema}
                fieldConfig={{
                  auth_token: {
                    inputProps: {
                      type: "password",
                    },
                  },
                }}
              />
            )}
            <QueueSettingsDialog
              machine={machine}
              open={queueSettingsOpen}
              setOpen={setQueueSettingsOpen}
            />
          </DropdownMenu>
        </div>
      );
    },
  },
];

function QueueSettingsDialog({
  machine,
  open,
  setOpen,
}: {
  machine: Machine;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const [queueSize, setQueueSize] = useState(machine.allow_comfyui_queue_size);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Queue Settings</DialogTitle>
          <DialogDescription>
            Configure queue settings for {machine.name}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Current Status</Label>
            <div className="mt-2 space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">
                  Operational Status:
                </span>
                <Badge
                  variant={
                    machine.operational_status === "idle" ? "success" : "amber"
                  }
                  className="capitalize"
                >
                  {machine.operational_status}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">
                  Current Queue:
                </span>
                <span className="text-sm font-medium">
                  {machine.current_queue_size} / {machine.allow_comfyui_queue_size}
                </span>
              </div>
            </div>
          </div>
          <div>
            <Label htmlFor="queue-size">Max Queue Size</Label>
            <Input
              id="queue-size"
              type="number"
              min="1"
              max="10"
              value={queueSize}
              onChange={(e) => setQueueSize(parseInt(e.target.value) || 1)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Maximum number of concurrent tasks allowed on this machine
            </p>
          </div>
          <Button
            onClick={async () => {
              await callServerPromise(
                updateMachineQueueSettings({
                  machine_id: machine.id,
                  allow_comfyui_queue_size: queueSize,
                }),
              );
              setOpen(false);
            }}
          >
            Save Settings
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MachineList({
  data,
  userMetadata,
}: {
  data: Machine[];
  userMetadata: z.infer<typeof AccessType>;
}) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});
  const [syncingAll, setSyncingAll] = React.useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = React.useState(true);

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
  });

  // 定时自动同步（每30秒）
  React.useEffect(() => {
    if (!autoSyncEnabled) return;

    const interval = setInterval(async () => {
      try {
        await callServerPromise(syncMachineQueueFromComfyUI());
      } catch (error) {
        console.error("Auto sync failed:", error);
      }
    }, 30000); // 30秒

    return () => clearInterval(interval);
  }, [autoSyncEnabled]);

  return (
    <div className="w-full">
      <div className="flex items-center py-4 gap-2">
        <Input
          placeholder="Filter machines..."
          value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
          onChange={(event) =>
            table.getColumn("name")?.setFilterValue(event.target.value)
          }
          className="max-w-sm"
        />
        <div className="ml-auto flex gap-2 items-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              id="auto-sync"
              checked={autoSyncEnabled}
              onCheckedChange={(checked) => setAutoSyncEnabled(!!checked)}
            />
            <label htmlFor="auto-sync" className="cursor-pointer">
              Auto Sync (30s)
            </label>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              setSyncingAll(true);
              try {
                await callServerPromise(syncMachineQueueFromComfyUI());
              } finally {
                setSyncingAll(false);
              }
            }}
            disabled={syncingAll}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${syncingAll ? "animate-spin" : ""}`} />
            Sync All Queues
          </Button>
          <InsertModal
            dialogClassName="sm:max-w-[600px]"
            disabled={
              data.some(
                (machine) => machine.type === "comfy-deploy-serverless"
              ) && !userMetadata.betaFeaturesAccess
            }
            tooltip={
              data.some((machine) => machine.type === "comfy-deploy-serverless")
                ? "Only one hosted machine at preview stage"
                : undefined
            }
            title="New Machine"
            description="Add custom ComfyUI machines to your account."
            serverAction={addCustomMachine}
            formSchema={addCustomMachineSchema}
            fieldConfig={{
              type: {
                fieldType: "fallback",
                inputProps: {
                  disabled: true,
                  showLabel: false,
                  type: "hidden",
                },
              },
              snapshot: {
                fieldType: "snapshot",
                inputProps: {
                  showLabel: false,
                },
              },
              models: {
                fieldType: "models",
                inputProps: {
                  showLabel: false,
                },
              },
              gpu: {
                fieldType: !userMetadata.betaFeaturesAccess
                  ? "fallback"
                  : "select",
                inputProps: {
                  disabled: !userMetadata.betaFeaturesAccess,
                },
              },
            }}
          />
          <InsertModal
            title="Custom Machine"
            description="Add custom comfyui machines to your account."
            serverAction={addMachine}
            formSchema={addMachineSchema}
          />
        </div>
      </div>
      <ScrollArea className="rounded-md  border w-full">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      <div className="flex items-center justify-end space-x-2 py-4">
        <div className="flex-1 text-sm text-muted-foreground">
          {table.getFilteredSelectedRowModel().rows.length} of{" "}
          {table.getFilteredRowModel().rows.length} row(s) selected.
        </div>
        <div className="space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
