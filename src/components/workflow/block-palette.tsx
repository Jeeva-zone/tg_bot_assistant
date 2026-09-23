"use client";

import * as React from "react";
import { GripVertical, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BLOCK_CATALOG,
  CATEGORY_ORDER,
  BLOCK_CATEGORY_LABEL,
} from "@/lib/workflow-blocks";
import type { BlockKind } from "@/types/workflow";

/**
 * MIME type used to carry the block kind through a drag. A custom type keeps the
 * payload from colliding with text dragged in from elsewhere on the page.
 */
export const BLOCK_DRAG_MIME = "application/x-tb-block";

/**
 * The script-block library.
 *
 * Drag-and-drop uses the native HTML5 API (the pattern React Flow documents for
 * palettes) rather than adding a second DnD dependency: the payload is a single
 * string, so a full drag-and-drop library would be weight without benefit. Every
 * card is also a button, so the palette stays usable by keyboard and on touch,
 * where HTML5 drag events do not fire.
 */
export function BlockPalette({
  onAdd,
  onClose,
}: {
  onAdd: (kind: BlockKind) => void;
  onClose?: () => void;
}) {
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return BLOCK_CATALOG;

    return BLOCK_CATALOG.filter(
      (definition) =>
        definition.title.toLowerCase().includes(needle) ||
        definition.summary.toLowerCase().includes(needle) ||
        definition.kind.includes(needle),
    );
  }, [query]);

  const grouped = React.useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        blocks: filtered.filter((definition) => definition.category === category),
      })).filter((group) => group.blocks.length > 0),
    [filtered],
  );

  function handleDragStart(event: React.DragEvent<HTMLButtonElement>, kind: BlockKind) {
    event.dataTransfer.setData(BLOCK_DRAG_MIME, kind);
    // Some browsers refuse a drag without any payload, so mirror into text/plain.
    event.dataTransfer.setData("text/plain", kind);
    event.dataTransfer.effectAllowed = "move";
  }

  return (
    <div className="flex h-full flex-col bg-card/40">
      {/* ---- Header ---- */}
      <div className="border-b p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Script blocks</h2>
          {onClose && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close block library"
              className="lg:hidden"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>

        <div className="relative mt-2.5">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search blocks…"
            aria-label="Search blocks"
            className="h-8 pl-8 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ---- Blocks ---- */}
      <ScrollArea className="flex-1">
        <div className="space-y-5 p-3">
          {grouped.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No blocks match “{query}”.
            </p>
          )}

          {grouped.map((group) => (
            <section key={group.category}>
              <h3 className="mb-2 px-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                {BLOCK_CATEGORY_LABEL[group.category]}
              </h3>

              <div className="space-y-1.5">
                {group.blocks.map((definition) => {
                  const Icon = definition.icon;

                  return (
                    <button
                      key={definition.kind}
                      type="button"
                      draggable
                      onDragStart={(event) => handleDragStart(event, definition.kind)}
                      onClick={() => onAdd(definition.kind)}
                      title={`Drag onto the canvas, or click to add — ${definition.summary}`}
                      className={cn(
                        "group flex w-full cursor-grab items-start gap-2.5 rounded-lg border bg-card p-2.5 text-left transition-colors",
                        "hover:border-primary/40 hover:bg-accent/60 active:cursor-grabbing",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      )}
                    >
                      <div
                        className={cn(
                          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
                          definition.accent.background,
                        )}
                      >
                        <Icon className={cn("size-3.5", definition.accent.text)} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-medium">{definition.title}</span>
                          <Plus className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </div>
                        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                          {definition.summary}
                        </p>
                      </div>

                      <GripVertical className="mt-1 size-3.5 shrink-0 text-muted-foreground/40" />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </ScrollArea>

      {/* ---- Footer hint ---- */}
      <div className="border-t p-3">
        <div className="flex items-start gap-2 rounded-md bg-muted/50 p-2">
          <Badge variant="muted" className="shrink-0 text-[9px]">
            TIP
          </Badge>
          <p className="text-[10px] leading-snug text-muted-foreground">
            Drag a block onto the canvas and connect its handle to the next block. Click any node to
            edit its parameters in the inspector.
          </p>
        </div>
      </div>
    </div>
  );
}
