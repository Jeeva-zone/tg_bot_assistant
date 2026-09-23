"use client";

import * as React from "react";
import type { NodeProps, NodeTypes } from "@xyflow/react";
import {
  Braces,
  GitBranch,
  Globe,
  Keyboard as KeyboardIcon,
  MessageSquare,
  Zap,
} from "lucide-react";
import { BlockShellForNode, NodeHint } from "./block-shell";
import { BLOCK_BY_KIND } from "@/lib/workflow-blocks";
import type {
  ApiNode,
  ConditionBlockData,
  ConditionNode,
  KeyboardNode,
  MessageNode,
  StateNode,
  TriggerNode,
} from "@/types/workflow";
import {
  FIELD_VALIDATOR_META_LABEL,
  OPERATOR_LABEL,
  SUBJECT_LABEL,
  TRIGGER_KIND_LABEL,
} from "@/lib/workflow-labels";

/** Trim a string to a single readable line for the node body. */
function oneLine(text: string, max = 68): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------------------
// 1. Trigger
// ---------------------------------------------------------------------------

function TriggerNodeView({ data, selected, id }: NodeProps<TriggerNode>) {
  const definition = BLOCK_BY_KIND.trigger;

  return (
    <BlockShellForNode
      nodeId={id}
      kind="trigger"
      label={data.label}
      summary={`${TRIGGER_KIND_LABEL[data.triggerKind]} · ${data.value || "not set"}`}
      icon={Zap}
      selected={Boolean(selected)}
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <code className="truncate rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
            {data.value || "—"}
          </code>
          {data.caseInsensitive && (
            <span className="text-[9px] text-muted-foreground">ignore case</span>
          )}
        </div>

        {data.aliases.length > 0 && (
          <NodeHint>aliases: {data.aliases.join(", ")}</NodeHint>
        )}

        {data.triggerKind === "regex" && (
          <NodeHint tone="warning">Compiles into the shared * dispatcher</NodeHint>
        )}
        {data.groupOnly && <NodeHint>Group chats only</NodeHint>}
      </div>
    </BlockShellForNode>
  );
}

// ---------------------------------------------------------------------------
// 2. Message
// ---------------------------------------------------------------------------

function MessageNodeView({ data, selected, id }: NodeProps<MessageNode>) {
  const media = data.media.filter((item) => item.source.trim().length > 0);

  return (
    <BlockShellForNode
      nodeId={id}
      kind="message"
      label={data.label}
      summary={`${data.parseMode} · ${data.text.length} chars`}
      icon={MessageSquare}
      selected={Boolean(selected)}
      footer={media.length > 0 ? `${media.length} attachment(s)` : undefined}
    >
      <div className="space-y-1.5">
        {data.text.trim() ? (
          <p className="rounded bg-muted/60 px-2 py-1.5 text-[10px] leading-snug break-words">
            {oneLine(data.text)}
          </p>
        ) : (
          <NodeHint tone="warning">No text — attachments only</NodeHint>
        )}

        {data.captureMessageId.trim() && (
          <NodeHint>message id → {data.captureMessageId}</NodeHint>
        )}
      </div>
    </BlockShellForNode>
  );
}

// ---------------------------------------------------------------------------
// 3. Keyboard
// ---------------------------------------------------------------------------

function KeyboardNodeView({ data, selected, id }: NodeProps<KeyboardNode>) {
  const buttons = data.rows.flat().filter((button) => button.text.trim().length > 0);

  return (
    <BlockShellForNode
      nodeId={id}
      kind="keyboard"
      label={data.label}
      summary={`${data.keyboardType === "inline" ? "Inline" : "Reply"} · ${buttons.length} button(s)`}
      icon={KeyboardIcon}
      selected={Boolean(selected)}
    >
      <div className="space-y-1.5">
        <p className="rounded bg-muted/60 px-2 py-1.5 text-[10px] leading-snug">
          {oneLine(data.text) || <span className="text-warning">Text required</span>}
        </p>

        {data.rows.length > 0 && (
          <div className="space-y-0.5">
            {data.rows.slice(0, 3).map((row, rowIndex) => (
              <div key={rowIndex} className="flex gap-0.5">
                {row
                  .filter((button) => button.text.trim())
                  .slice(0, 3)
                  .map((button) => (
                    <span
                      key={button.id}
                      className="min-w-0 flex-1 truncate rounded border bg-background px-1 py-0.5 text-center text-[9px]"
                    >
                      {button.text}
                    </span>
                  ))}
              </div>
            ))}
            {data.rows.length > 3 && (
              <NodeHint>+{data.rows.length - 3} more row(s)</NodeHint>
            )}
          </div>
        )}
      </div>
    </BlockShellForNode>
  );
}

// ---------------------------------------------------------------------------
// 4. API fetch
// ---------------------------------------------------------------------------

function ApiNodeView({ data, selected, id }: NodeProps<ApiNode>) {
  const secretHeaders = data.headers.filter((header) => header.secret).length;

  return (
    <BlockShellForNode
      nodeId={id}
      kind="api"
      label={data.label}
      summary={`${data.method} · ${data.timeoutMs / 1000}s timeout`}
      icon={Globe}
      selected={Boolean(selected)}
      footer={`response → ${data.bindTo || "unbound"}`}
    >
      <div className="space-y-1.5">
        <code className="block truncate rounded bg-muted/60 px-2 py-1.5 font-mono text-[10px]">
          {oneLine(data.url, 44) || "no url"}
        </code>

        {data.headers.length > 0 && (
          <NodeHint>
            {data.headers.length} header(s)
            {secretHeaders > 0 ? `, ${secretHeaders} from env` : ""}
          </NodeHint>
        )}

        {data.haltOnError && <NodeHint tone="warning">Stops the flow on failure</NodeHint>}
      </div>
    </BlockShellForNode>
  );
}

// ---------------------------------------------------------------------------
// 5. Condition
// ---------------------------------------------------------------------------

function describeCondition(data: ConditionBlockData): string {
  const subject =
    data.subject === "variable"
      ? data.variable || "(no variable)"
      : SUBJECT_LABEL[data.subject];

  const operator = OPERATOR_LABEL[data.operator];
  const needsValue = !["isTruthy", "isEmpty"].includes(data.operator);

  return needsValue
    ? `${subject} ${operator} "${data.compareValue}"`
    : `${subject} ${operator}`;
}

function ConditionNodeView({ data, selected, id }: NodeProps<ConditionNode>) {
  return (
    <BlockShellForNode
      nodeId={id}
      kind="condition"
      label={data.label}
      summary={data.caseInsensitive ? "case-insensitive" : "case-sensitive"}
      icon={GitBranch}
      selected={Boolean(selected)}
    >
      <div className="space-y-1.5">
        <code className="block rounded bg-warning/10 px-2 py-1.5 font-mono text-[10px] leading-snug break-words text-warning">
          {describeCondition(data)}
        </code>
        <NodeHint>true → right-top · false → right-bottom</NodeHint>
      </div>
    </BlockShellForNode>
  );
}

// ---------------------------------------------------------------------------
// 6. State / form input
// ---------------------------------------------------------------------------

function StateNodeView({ data, selected, id }: NodeProps<StateNode>) {
  return (
    <BlockShellForNode
      nodeId={id}
      kind="state"
      label={data.label}
      summary={`saves to ${data.variable || "unset"}`}
      icon={Braces}
      selected={Boolean(selected)}
      footer={
        data.scope === "user" ? "Stored per user (db.user)" : "Shared across users (db.bot)"
      }
    >
      <div className="space-y-1.5">
        <p className="rounded bg-muted/60 px-2 py-1.5 text-[10px] leading-snug">
          {oneLine(data.prompt) || <span className="text-warning">Prompt required</span>}
        </p>

        <div className="flex flex-wrap gap-1">
          <span className="rounded bg-chart-4/15 px-1.5 py-0.5 text-[9px] text-chart-4">
            {FIELD_VALIDATOR_META_LABEL[data.validator]}
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
            {data.required ? "required" : "optional"}
          </span>
        </div>

        <NodeHint tone="warning">Pauses the flow for the next message</NodeHint>
      </div>
    </BlockShellForNode>
  );
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Memoised so React Flow does not re-render every node when one node's data
 * changes — on a large canvas that is the difference between smooth and janky.
 */
export const nodeTypes: NodeTypes = {
  trigger: React.memo(TriggerNodeView),
  message: React.memo(MessageNodeView),
  keyboard: React.memo(KeyboardNodeView),
  api: React.memo(ApiNodeView),
  condition: React.memo(ConditionNodeView),
  state: React.memo(StateNodeView),
};
