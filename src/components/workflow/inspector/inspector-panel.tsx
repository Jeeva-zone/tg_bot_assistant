"use client";

import * as React from "react";
import { Copy, Info, MousePointerClick, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { BLOCK_BY_KIND } from "@/lib/workflow-blocks";
import { TRIGGER_KIND_LABEL } from "@/lib/workflow-labels";
import type { ValidationIssue, WorkflowNode } from "@/types/workflow";
import { useWorkflow } from "@/store/useWorkflow";
import { BlockEditor } from "./block-editors";
import { IssueList } from "./fields";

/**
 * Right-hand inspector.
 *
 * Clicking a node opens its parameter editor here. Validation is scoped to the
 * selected node so problems appear next to the fields that caused them, while
 * graph-wide issues (cycles, orphans) stay in the bottom panel where they cannot be
 * mistaken for a problem with this block.
 */
export function InspectorPanel({
  node,
  issues,
  onClose,
}: {
  node: WorkflowNode | null;
  issues: ValidationIssue[];
  onClose?: () => void;
}) {
  const updateNodeData = useWorkflow((state) => state.updateNodeData);
  const removeNode = useWorkflow((state) => state.removeNode);
  const duplicateNode = useWorkflow((state) => state.duplicateNode);

  const update = React.useCallback(
    (patch: Partial<WorkflowNode["data"]>) => {
      if (!node) return;
      updateNodeData(node.id, patch);
    },
    [node, updateNodeData],
  );

  // ---- Empty state ----
  if (!node) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <h2 className="text-sm font-semibold">Inspector</h2>
          {onClose && (
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close inspector" className="xl:hidden">
              <X className="size-4" />
            </Button>
          )}
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <MousePointerClick className="size-7 text-muted-foreground/50" />
          <p className="text-sm font-medium">No block selected</p>
          <p className="max-w-[15rem] text-xs text-muted-foreground">
            Click any node on the canvas to edit its parameters here.
          </p>
        </div>
      </div>
    );
  }

  const definition = BLOCK_BY_KIND[node.type as keyof typeof BLOCK_BY_KIND];
  const Icon = definition.icon;
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;

  return (
    <div className="flex h-full flex-col">
      {/* ---- Header ---- */}
      <div className="border-b px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded",
              definition.accent.background,
            )}
          >
            <Icon className={cn("size-3.5", definition.accent.text)} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {definition.title}
            </div>
          </div>

          <Badge
            variant={node.data.kind === "trigger" ? "default" : "muted"}
            className="shrink-0 text-[9px]"
          >
            {node.data.kind === "trigger"
              ? TRIGGER_KIND_LABEL[(node.data as { triggerKind: keyof typeof TRIGGER_KIND_LABEL }).triggerKind]
              : node.type}
          </Badge>

          {onClose && (
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close inspector" className="size-6 xl:hidden">
              <X className="size-3.5" />
            </Button>
          )}
        </div>

        <Input
          value={node.data.label}
          onChange={(event) => update({ label: event.target.value })}
          aria-label="Block name"
          placeholder="Block name"
          className="mt-2 h-7 border-transparent bg-transparent px-1 text-sm font-medium shadow-none focus-visible:border-input focus-visible:bg-background"
        />

        {(errors > 0 || warnings > 0) && (
          <div className="mt-1.5 flex gap-1.5">
            {errors > 0 && (
              <Badge variant="destructive" className="text-[9px]">
                {errors} error{errors === 1 ? "" : "s"}
              </Badge>
            )}
            {warnings > 0 && (
              <Badge variant="warning" className="text-[9px]">
                {warnings} warning{warnings === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* ---- Body ---- */}
      <ScrollArea className="flex-1">
        <div className="space-y-6 p-3">
          {issues.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Problems
              </h3>
              <IssueList issues={issues} />
            </section>
          )}

          <BlockEditor data={node.data} issues={issues} update={update} />

          <Separator />

          {/* ---- Node actions ---- */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Block actions
            </h3>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => duplicateNode(node.id)}
              >
                <Copy className="size-3.5" />
                Duplicate
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => removeNode(node.id)}
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            </div>

            <p className="flex gap-1.5 text-[10px] leading-snug text-muted-foreground">
              <Info className="mt-px size-3 shrink-0" />
              <span>
                Block id: <code className="font-mono">{node.id}</code>
              </span>
            </p>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
