"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { TRIGGER_KIND_META, type CommandNode } from "@/types/builder";
import { triggerToName } from "@/lib/compiler";
import { useBuilder } from "@/store/useBuilder";

function triggerBadge(node: CommandNode) {
  const name = triggerToName(node.trigger);
  const meta = TRIGGER_KIND_META[node.trigger.kind];

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <code
          className={cn(
            "truncate rounded px-1.5 py-0.5 text-[11px] font-medium",
            node.trigger.kind === "wildcard"
              ? "bg-warning/15 text-warning-foreground"
              : "bg-primary/10 text-primary",
          )}
        >
          {name || "—"}
        </code>
        {node.flow.enabled && node.flow.steps.length > 0 && (
          <Badge variant="muted" className="shrink-0 text-[10px]">
            {node.flow.steps.length}-step form
          </Badge>
        )}
      </div>
      <span className="truncate text-[11px] text-muted-foreground">{meta.label}</span>
    </div>
  );
}

function CommandRow({ node, index, total }: { node: CommandNode; index: number; total: number }) {
  const selectedCommandId = useBuilder((state) => state.selectedCommandId);
  const selectCommand = useBuilder((state) => state.selectCommand);
  const setCommandEnabled = useBuilder((state) => state.setCommandEnabled);
  const duplicateCommand = useBuilder((state) => state.duplicateCommand);
  const removeCommand = useBuilder((state) => state.removeCommand);
  const moveCommand = useBuilder((state) => state.moveCommand);
  const setCommandLabel = useBuilder((state) => state.setCommandLabel);

  const selected = selectedCommandId === node.id;

  return (
    <div
      className={cn(
        "group relative rounded-lg border transition-colors",
        selected ? "border-primary/50 bg-primary/5" : "border-transparent hover:bg-accent/60",
        !node.enabled && "opacity-55",
      )}
    >
      <button
        type="button"
        onClick={() => selectCommand(node.id)}
        aria-current={selected ? "true" : undefined}
        className="flex w-full items-start gap-2 p-2.5 text-left"
      >
        <GripVertical className="mt-1 size-3.5 shrink-0 text-muted-foreground/40" />

        <div className="min-w-0 flex-1">
          <Input
            value={node.label}
            onChange={(event) => setCommandLabel(node.id, event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onFocus={() => selectCommand(node.id)}
            aria-label={`Label for command ${index + 1}`}
            className="h-6 border-transparent bg-transparent px-1 text-[13px] font-medium shadow-none focus-visible:border-input focus-visible:bg-background"
          />
          <div className="mt-1.5 px-1">{triggerBadge(node)}</div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Switch
            checked={node.enabled}
            onCheckedChange={(checked) => setCommandEnabled(node.id, checked)}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Enable ${node.label}`}
            className="scale-90"
          />
        </div>
      </button>

      {/* Row actions appear on hover / focus-within to keep the list calm. */}
      <div className="flex items-center gap-0.5 border-t border-dashed px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => moveCommand(node.id, -1)}
          disabled={index === 0}
          aria-label="Move up"
          className="size-6"
        >
          <ChevronUp className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => moveCommand(node.id, 1)}
          disabled={index === total - 1}
          aria-label="Move down"
          className="size-6"
        >
          <ChevronDown className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => duplicateCommand(node.id)}
          aria-label="Duplicate"
          className="size-6"
        >
          <Copy className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => removeCommand(node.id)}
          aria-label="Delete"
          className="ml-auto size-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </div>
  );
}

export function CommandList() {
  const project = useBuilder((state) => state.project);
  const addCommand = useBuilder((state) => state.addCommand);
  const setProjectName = useBuilder((state) => state.setProjectName);

  const wildcardCount = project.commands.filter(
    (node) => node.trigger.kind === "wildcard",
  ).length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <label htmlFor="project-name" className="sr-only">
          Project name
        </label>
        <Input
          id="project-name"
          value={project.name}
          onChange={(event) => setProjectName(event.target.value)}
          placeholder="Project name"
          className="h-8 border-transparent bg-transparent px-1 text-sm font-semibold shadow-none focus-visible:border-input focus-visible:bg-background"
        />
        <div className="mt-1 flex items-center justify-between px-1">
          <span className="text-[11px] text-muted-foreground">
            {project.commands.length} command{project.commands.length === 1 ? "" : "s"}
          </span>
          {wildcardCount > 0 && (
            <Badge variant={wildcardCount > 1 ? "destructive" : "muted"} className="text-[10px]">
              {wildcardCount} wildcard{wildcardCount > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          {project.commands.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <Zap className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-2 text-xs text-muted-foreground">
                No commands yet. Add your first trigger to get started.
              </p>
            </div>
          )}

          {project.commands.map((node, index) => (
            <CommandRow
              key={node.id}
              node={node}
              index={index}
              total={project.commands.length}
            />
          ))}
        </div>
      </ScrollArea>

      <div className="border-t p-2">
        <Button variant="outline" size="sm" className="w-full" onClick={() => addCommand()}>
          <Plus className="size-3.5" />
          Add command
        </Button>
      </div>
    </div>
  );
}
