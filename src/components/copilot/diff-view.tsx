"use client";

import * as React from "react";
import { ArrowRight, Minus, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { collapseUnchanged, diffLines, summariseDiff } from "@/lib/diff";
import { cn } from "@/lib/utils";

/**
 * Side-by-side-ish diff of the generated code against what the bot already has.
 *
 * Before deploying, the user needs to see what is *changing*. For a command that does
 * not exist yet the diff is simply "all added", but for a redeploy of an edited command
 * the meaningful information is the handful of lines that differ — so long runs of
 * unchanged code collapse to a "N unchanged lines" marker instead of burying the change.
 */
export function DiffView({
  oldCode,
  newCode,
  oldLabel = "Current",
  newLabel = "Generated",
  maxHeight = "max-h-[22rem]",
}: {
  oldCode: string;
  newCode: string;
  oldLabel?: string;
  newLabel?: string;
  maxHeight?: string;
}) {
  const { items, stats } = React.useMemo(() => {
    const lines = diffLines(oldCode, newCode);
    return { items: collapseUnchanged(lines).items, stats: summariseDiff(lines) };
  }, [oldCode, newCode]);

  const isNewCommand = oldCode.trim().length === 0;

  return (
    <div className="space-y-2">
      {/* ---- Summary ---- */}
      <div className="flex flex-wrap items-center gap-1.5">
        {isNewCommand ? (
          <Badge variant="success" className="gap-1 text-[10px]">
            <Plus className="size-3" />
            New command — {stats.added} line{stats.added === 1 ? "" : "s"}
          </Badge>
        ) : stats.identical ? (
          <Badge variant="muted" className="text-[10px]">
            No change — identical to the deployed version
          </Badge>
        ) : (
          <>
            <Badge variant="success" className="gap-1 text-[10px]">
              <Plus className="size-3" />
              {stats.added} added
            </Badge>
            <Badge variant="destructive" className="gap-1 text-[10px]">
              <Minus className="size-3" />
              {stats.removed} removed
            </Badge>
            <Badge variant="muted" className="text-[10px]">
              {stats.unchanged} unchanged
            </Badge>
          </>
        )}

        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          {oldLabel}
          <ArrowRight className="size-3" />
          {newLabel}
        </span>
      </div>

      {/* ---- Diff body ---- */}
      <ScrollArea className={cn("rounded-lg border bg-muted/20", maxHeight)}>
        <div className="code-block">
          {items.map((item, index) => {
            if (item.kind === "gap") {
              return (
                <div
                  key={`gap-${index}`}
                  className="border-y bg-muted/40 px-3 py-1 text-center text-[10px] text-muted-foreground"
                >
                  ⋯ {item.count} unchanged line{item.count === 1 ? "" : "s"} ⋯
                </div>
              );
            }

            const isAdded = item.kind === "added";
            const isRemoved = item.kind === "removed";

            return (
              <div
                key={index}
                className={cn(
                  "flex items-start gap-2 px-2 py-0.5",
                  isAdded && "bg-success/10",
                  isRemoved && "bg-destructive/10",
                )}
              >
                <span
                  className={cn(
                    "w-3 shrink-0 text-center select-none",
                    isAdded && "text-success",
                    isRemoved && "text-destructive",
                    !isAdded && !isRemoved && "text-muted-foreground/40",
                  )}
                  aria-hidden
                >
                  {isAdded ? "+" : isRemoved ? "−" : " "}
                </span>

                <span className="w-8 shrink-0 text-right text-muted-foreground/50 select-none">
                  {isAdded ? item.newLine : item.oldLine}
                </span>

                <span
                  className={cn(
                    "min-w-0 flex-1 whitespace-pre-wrap break-words",
                    isRemoved && "text-destructive/80 line-through decoration-destructive/40",
                  )}
                >
                  {item.text || " "}
                </span>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
