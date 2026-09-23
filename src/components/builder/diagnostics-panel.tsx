"use client";

import * as React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CompileResult } from "@/lib/compiler";
import { cn } from "@/lib/utils";

const LEVEL_STYLES = {
  error: {
    icon: AlertCircle,
    wrap: "border-destructive/40 bg-destructive/5",
    text: "text-destructive",
  },
  warning: {
    icon: AlertTriangle,
    wrap: "border-warning/40 bg-warning/5",
    text: "text-warning",
  },
  info: {
    icon: Info,
    wrap: "border-border bg-muted/40",
    text: "text-muted-foreground",
  },
} as const;

export function DiagnosticsPanel({
  compiled,
  className,
}: {
  compiled: CompileResult;
  className?: string;
}) {
  const errors = compiled.diagnostics.filter((item) => item.level === "error");
  const warnings = compiled.diagnostics.filter((item) => item.level === "warning");

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <span className="text-xs font-medium">Build check</span>
        {errors.length > 0 && (
          <Badge variant="destructive" className="gap-1 text-[10px]">
            <AlertCircle className="size-3" />
            {errors.length} error{errors.length === 1 ? "" : "s"}
          </Badge>
        )}
        {warnings.length > 0 && (
          <Badge variant="warning" className="gap-1 text-[10px]">
            <AlertTriangle className="size-3" />
            {warnings.length} warning{warnings.length === 1 ? "" : "s"}
          </Badge>
        )}
        {errors.length === 0 && warnings.length === 0 && (
          <Badge variant="success" className="gap-1 text-[10px]">
            <CheckCircle2 className="size-3" />
            Ready to deploy
          </Badge>
        )}
      </div>

      <ScrollArea className="max-h-72 flex-1">
        <div className="space-y-2 p-3">
          {compiled.diagnostics.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No problems found. This project compiles to{" "}
              {compiled.stats.commandCount} TeleBotHost command
              {compiled.stats.commandCount === 1 ? "" : "s"}.
            </p>
          )}

          {compiled.diagnostics.map((item, index) => {
            const style = LEVEL_STYLES[item.level];
            const Icon = style.icon;

            return (
              <div
                key={`${item.level}-${index}`}
                className={cn("flex gap-2 rounded-md border p-2.5", style.wrap)}
              >
                <Icon className={cn("mt-0.5 size-3.5 shrink-0", style.text)} />
                <div className="min-w-0 text-xs">
                  {item.nodeLabel && (
                    <span className="font-medium">{item.nodeLabel}: </span>
                  )}
                  <span className="text-muted-foreground">{item.message}</span>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

/** Compact stat strip shown above the diagnostics list. */
export function CompileStats({ compiled }: { compiled: CompileResult }) {
  const items = [
    { label: "Builder nodes", value: compiled.stats.nodeCount },
    { label: "TBL commands", value: compiled.stats.commandCount },
    { label: "Regex rules", value: compiled.stats.regexRules },
    { label: "Disabled", value: compiled.stats.skipped },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 border-b p-3 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border bg-card px-2.5 py-2">
          <div className="font-mono text-sm font-semibold">{item.value}</div>
          <div className="text-[10px] text-muted-foreground">{item.label}</div>
        </div>
      ))}
    </div>
  );
}
