"use client";

import * as React from "react";
import { Handle, Position } from "@xyflow/react";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { BLOCK_HANDLES } from "@/lib/workflow-blocks";
import type { BlockKind } from "@/types/workflow";
import { useNodeIssues } from "@/components/workflow/workflow-context";
/**
 * Shared chrome for every block node: accent stripe, header, validation badge and
 * typed connection handles.
 *
 * Handle placement is driven by `BLOCK_HANDLES` so the visual affordances can never
 * drift from what the compiler expects — a condition always renders exactly two
 * source handles, a trigger never renders an input.
 */

type BlockShellProps = {
  kind: BlockKind;
  label: string;
  /** One-line description of the block's configured state, shown under the header. */
  summary: string;
  icon: React.ComponentType<{ className?: string }>;
  selected: boolean;
  /** Highlighted because validation found something, even when not selected. */
  invalid: boolean;
  children?: React.ReactNode;
  /** Optional footer, e.g. a preview of buttons. */
  footer?: React.ReactNode;
  className?: string;
};

export function BlockShell({
  kind,
  label,
  summary,
  icon: Icon,
  selected,
  invalid,
  children,
  footer,
  className,
}: BlockShellProps) {
  const spec = BLOCK_HANDLES[kind];

  return (
    <div
      className={cn(
        "relative w-[248px] rounded-lg border-l-4 border border-border bg-card text-card-foreground shadow-sm transition-all",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        invalid && !selected && "border-destructive/60",
        className,
      )}
    >
      {/* ---- Header ---- */}
      <div className="flex items-start gap-2 px-3 pt-2.5 pb-2">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium leading-tight">{label}</div>
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{summary}</div>
        </div>
      </div>

      {children && <div className="px-3 pb-2.5">{children}</div>}

      {footer && (
        <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">{footer}</div>
      )}

      {/* ---- Handles ---- */}
      {spec.hasInput && (
        <Handle
          type="target"
          id="in"
          position={Position.Left}
          className="!size-3 !border-2 !border-background !bg-muted-foreground"
        />
      )}

      {spec.outputs.map((output, index) => {
        const multiple = spec.outputs.length > 1;
        // Split multiple outputs vertically so the branch labels have room.
        const top = multiple ? `${((index + 1) / (spec.outputs.length + 1)) * 100}%` : "50%";

        return (
          <React.Fragment key={output.id}>
            <Handle
              type="source"
              id={output.id}
              position={Position.Right}
              style={{ top }}
              className={cn(
                "!size-3 !border-2 !border-background",
                output.id === "true" && "!bg-success",
                output.id === "false" && "!bg-destructive",
                output.id === "out" && "!bg-primary",
              )}
            />
            {output.label && (
              <span
                className="pointer-events-none absolute right-0 translate-x-[calc(100%+10px)] -translate-y-1/2 text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
                style={{ top }}
              >
                {output.label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/**
 * Wrapper that supplies the node id to the issues hook. Node components use this so
 * they do not each have to remember to thread the id through.
 */
export function BlockShellForNode(
  props: Omit<BlockShellProps, "invalid"> & { nodeId: string },
) {
  const issues = useNodeIssues(props.nodeId);
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;

  return (
    <div className="relative">
      <BlockShell {...props} invalid={errors > 0} />

      {(errors > 0 || warnings > 0) && (
        <div className="absolute -top-2 -right-2 flex gap-1">
          {errors > 0 && (
            <span
              title={issues
                .filter((issue) => issue.severity === "error")
                .map((issue) => issue.message)
                .join("\n")}
              className="flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground shadow"
            >
              {errors > 9 ? "9+" : errors}
            </span>
          )}
          {warnings > 0 && (
            <span
              title={issues
                .filter((issue) => issue.severity === "warning")
                .map((issue) => issue.message)
                .join("\n")}
              className="flex size-5 items-center justify-center rounded-full bg-warning text-[10px] font-semibold text-warning-foreground shadow"
            >
              {warnings > 9 ? "9+" : warnings}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Small icon + text row used inside node bodies. */
export function NodeHint({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "error" | "warning";
  children: React.ReactNode;
}) {
  const Icon = tone === "error" ? AlertCircle : tone === "warning" ? AlertTriangle : null;

  return (
    <div
      className={cn(
        "flex items-start gap-1.5 text-[10px] leading-snug",
        tone === "error" && "text-destructive",
        tone === "warning" && "text-warning",
        tone === "muted" && "text-muted-foreground",
      )}
    >
      {Icon && <Icon className="mt-px size-3 shrink-0" />}
      <span className="min-w-0">{children}</span>
    </div>
  );
}
