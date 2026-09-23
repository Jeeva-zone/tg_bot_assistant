/**
 * Types for the visual workflow editor.
 *
 * The canvas is a directed graph of script blocks. This module defines the strict
 * shape of every block, the graph document, and the compiler's result types.
 *
 * NOTE ON STYLE: block data shapes are declared with `type` aliases rather than
 * `interface`. React Flow constrains node data to `Record<string, unknown>`, and
 * TypeScript only grants an implicit index signature to *type aliases* — an
 * `interface` with the same members is rejected. Using `interface` here would force
 * an explicit `[key: string]: unknown` escape hatch and lose real type safety.
 */

import type { Edge, Node, NodeProps } from "@xyflow/react";
import type { TblParseMode } from "./telegram";

export type { TblParseMode };

// ---------------------------------------------------------------------------
// Block taxonomy
// ---------------------------------------------------------------------------

/** The six script-block kinds available in the palette. */
export type BlockKind = "trigger" | "message" | "keyboard" | "api" | "condition" | "state";

/** Palette grouping. Drives the sidebar sections and node accent colours. */
export type BlockCategory = "entry" | "content" | "logic" | "data";

export const BLOCK_CATEGORY_LABEL: Record<BlockCategory, string> = {
  entry: "Entry points",
  content: "Content",
  logic: "Logic & branching",
  data: "Data & state",
};

// ---------------------------------------------------------------------------
// Shared validation types
// ---------------------------------------------------------------------------

export type ValidationSeverity = "error" | "warning";

/**
 * A problem found by the live validator or the compiler. Rendered both on the
 * node itself (a badge) and in the inspector (field-level detail).
 */
export type ValidationIssue = {
  nodeId: string;
  severity: ValidationSeverity;
  /** Data field the issue belongs to, when it maps to one. */
  field?: string;
  message: string;
};

/** A minimal shape every block shares. */
type BlockBase = {
  kind: BlockKind;
  /** User-editable display name shown on the node header. */
  label: string;
};

// ---------------------------------------------------------------------------
// 1. Trigger block
// ---------------------------------------------------------------------------

/**
 * How the bot is entered.
 *
 * `command`, `keyword`, `regex`, `wildcard` and `callback` mirror TeleBotHost's
 * routing rules. `inline` is handled by the `/handle_inline_query` dynamic handler,
 * because TBL routes inline queries through a dedicated update-type handler rather
 * than the normal name match.
 */
export type TriggerKind =
  | "command"
  | "keyword"
  | "regex"
  | "wildcard"
  | "callback"
  | "inline";

export type TriggerBlockData = BlockBase & {
  kind: "trigger";
  triggerKind: TriggerKind;
  /** Literal trigger. `/start`, `Help`, a regex source, or `*`. */
  value: string;
  caseInsensitive: boolean;
  aliases: string[];
  groupOnly: boolean;
};

// ---------------------------------------------------------------------------
// 2. Message response block
// ---------------------------------------------------------------------------

export type MediaKind = "photo" | "document" | "video" | "audio";

export type MediaAttachment = {
  id: string;
  kind: MediaKind;
  /** Public URL or an existing Telegram file_id. */
  source: string;
  caption: string;
};

export type MessageBlockData = BlockBase & {
  kind: "message";
  /**
   * Message body. Supports `{{variable}}` interpolation, which the compiler lowers
   * to string concatenation against the bound variable.
   */
  text: string;
  parseMode: TblParseMode;
  media: MediaAttachment[];
  /**
   * When set, the sent message id is stored in this variable so later blocks can
   * edit or delete it.
   */
  captureMessageId: string;
};

// ---------------------------------------------------------------------------
// 3. Keyboard block
// ---------------------------------------------------------------------------

export type KeyboardType = "inline" | "reply";

/** `url` opens a link, `callback` re-enters the router, `webapp` opens a Mini App. */
export type KeyboardAction = "url" | "callback" | "webapp";

export type KeyboardButtonDef = {
  id: string;
  text: string;
  action: KeyboardAction;
  value: string;
};

export type KeyboardBlockData = BlockBase & {
  kind: "keyboard";
  keyboardType: KeyboardType;
  /**
   * Message the keyboard is attached to. Telegram cannot send a reply_markup
   * without a message body, so this is required even when the previous block
   * already sent something.
   */
  text: string;
  parseMode: TblParseMode;
  /** Rows of buttons, so the author controls wrapping. */
  rows: KeyboardButtonDef[][];
  // Reply-keyboard-only presentation options.
  resize: boolean;
  oneTime: boolean;
  placeholder: string;
};

// ---------------------------------------------------------------------------
// 4. API fetch block
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiHeaderDef = {
  id: string;
  name: string;
  /**
   * Header value. When `secret` is true the compiler refuses to inline the value
   * and instead emits `process.env.<name>`, so the credential lives in
   * TeleBotHost's environment variables rather than in generated source.
   */
  value: string;
  secret: boolean;
};

export type ApiBlockData = BlockBase & {
  kind: "api";
  method: HttpMethod;
  url: string;
  headers: ApiHeaderDef[];
  /** JSON body template. Only sent for methods that carry a body. */
  body: string;
  /** Variable the parsed JSON response is bound to. */
  bindTo: string;
  /** Request timeout in milliseconds. */
  timeoutMs: number;
  /** Sent to the chat when the request fails or returns a non-2xx status. */
  errorMessage: string;
  /** Stop the flow when the request fails. */
  haltOnError: boolean;
};

// ---------------------------------------------------------------------------
// 5. Condition / branch block
// ---------------------------------------------------------------------------

/** What the rule is evaluated against. */
export type ConditionSubject = "message" | "variable" | "params" | "chatType";

export type ConditionOperator =
  | "contains"
  | "notContains"
  | "equals"
  | "startsWith"
  | "endsWith"
  | "matchesRegex"
  | "isTruthy"
  | "isEmpty"
  | "greaterThan"
  | "lessThan";

export type ConditionBlockData = BlockBase & {
  kind: "condition";
  subject: ConditionSubject;
  /** Variable name, used when `subject === "variable"`. */
  variable: string;
  operator: ConditionOperator;
  compareValue: string;
  caseInsensitive: boolean;
};

// ---------------------------------------------------------------------------
// 6. State / form block
// ---------------------------------------------------------------------------

export type StateValidator = "none" | "text" | "email" | "phone" | "number" | "url";

export type StateBlockData = BlockBase & {
  kind: "state";
  /** Variable the captured answer is written to. */
  variable: string;
  /** Question shown to the user before the bot pauses for input. */
  prompt: string;
  validator: StateValidator;
  required: boolean;
  errorMessage: string;
  /** `db.user` scopes per user; `db.bot` shares one record across everyone. */
  scope: "user" | "bot";
  /** Optional acknowledgement sent after the answer is saved. */
  confirmMessage: string;
};

// ---------------------------------------------------------------------------
// Node & graph types
// ---------------------------------------------------------------------------

export type WorkflowNodeData =
  | TriggerBlockData
  | MessageBlockData
  | KeyboardBlockData
  | ApiBlockData
  | ConditionBlockData
  | StateBlockData;

/**
 * One node type per block kind. Declaring them individually (rather than a single
 * `Node<WorkflowNodeData>`) means each node component receives fully narrowed data
 * through `NodeProps`, instead of having to re-check `data.kind` everywhere.
 */
export type TriggerNode = Node<TriggerBlockData, "trigger">;
export type MessageNode = Node<MessageBlockData, "message">;
export type KeyboardNode = Node<KeyboardBlockData, "keyboard">;
export type ApiNode = Node<ApiBlockData, "api">;
export type ConditionNode = Node<ConditionBlockData, "condition">;
export type StateNode = Node<StateBlockData, "state">;

export type WorkflowNode =
  | TriggerNode
  | MessageNode
  | KeyboardNode
  | ApiNode
  | ConditionNode
  | StateNode;

/** Edges are plain; condition branches are distinguished by `sourceHandle`. */
export type WorkflowEdge = Edge;

/** Handle identifiers. Condition nodes expose two distinct source handles. */
export const HANDLE = {
  /** Shared target handle id for every non-trigger block. */
  INPUT: "in",
  /** Default source handle id. */
  OUTPUT: "out",
  /** Condition branch handles. */
  TRUE: "true",
  FALSE: "false",
} as const;

export type BranchHandle = typeof HANDLE.TRUE | typeof HANDLE.FALSE;

/** The persisted workflow document. */
export type WorkflowDocument = {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: string;
  updatedAt: string;
};

/** Props passed to every custom node component. */
export type BlockNodeProps = NodeProps<WorkflowNode>;

// ---------------------------------------------------------------------------
// Compiler result types
// ---------------------------------------------------------------------------

/** A TeleBotHost command produced from one trigger subgraph. */
export type CompiledWorkflowCommand = {
  /** TBL command name — the trigger. */
  name: string;
  answer: string;
  code: string;
  parse_mode: string;
  keyboard: string;
  aliases: string[];
  need_reply: boolean;
  case_insensitive: boolean;
  allow_only_group: boolean;
  is_web: number;
  folder: string;
  /** Node ids that contributed to this command, for traceability. */
  sourceNodeIds: string[];
};

export type WorkflowCompileStats = {
  nodeCount: number;
  edgeCount: number;
  triggerCount: number;
  commandCount: number;
  stateBlocks: number;
  /** Nodes not reachable from any trigger. */
  orphanCount: number;
};

export type WorkflowCompileResult = {
  commands: CompiledWorkflowCommand[];
  issues: ValidationIssue[];
  hasErrors: boolean;
  stats: WorkflowCompileStats;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let counter = 0;

export function createWorkflowId(prefix = "wf"): string {
  counter += 1;
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}${counter}`;
}

export function createEmptyDocument(name = "Untitled Workflow"): WorkflowDocument {
  const now = new Date().toISOString();
  return {
    id: createWorkflowId("doc"),
    name,
    description: "",
    nodes: [],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Narrow a node to a specific block kind. */
export function isBlock<K extends BlockKind>(
  node: WorkflowNode | undefined,
  kind: K,
): node is Extract<WorkflowNode, { type: K }> {
  return node?.type === kind;
}
