/**
 * The script-block catalog.
 *
 * Single source of truth for the palette, the node factory, handle layout and
 * per-field validation. Keeping these together means adding a block kind is one
 * edit rather than five, and the inspector can never drift from the compiler's
 * expectations.
 */

import {
  Braces,
  GitBranch,
  Globe,
  Keyboard as KeyboardIcon,
  MessageSquare,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Node } from "@xyflow/react";
import {
  BLOCK_CATEGORY_LABEL,
  HANDLE,
  createWorkflowId,
  type ApiBlockData,
  type BlockCategory,
  type BlockKind,
  type ConditionBlockData,
  type KeyboardBlockData,
  type MessageBlockData,
  type StateBlockData,
  type TriggerBlockData,
  type ValidationSeverity,
  type WorkflowNode,
  type WorkflowNodeData,
} from "@/types/workflow";

// ---------------------------------------------------------------------------
// Handle layout
// ---------------------------------------------------------------------------

export type HandleSpec = {
  /** Whether the block accepts an inbound connection. */
  hasInput: boolean;
  /** Named source handles. A condition has two; everything else has one. */
  outputs: { id: string; label: string }[];
};

export const BLOCK_HANDLES: Record<BlockKind, HandleSpec> = {
  // A trigger roots a command, so nothing can flow into it.
  trigger: { hasInput: false, outputs: [{ id: HANDLE.OUTPUT, label: "" }] },
  message: { hasInput: true, outputs: [{ id: HANDLE.OUTPUT, label: "" }] },
  keyboard: { hasInput: true, outputs: [{ id: HANDLE.OUTPUT, label: "" }] },
  api: { hasInput: true, outputs: [{ id: HANDLE.OUTPUT, label: "" }] },
  condition: {
    hasInput: true,
    outputs: [
      { id: HANDLE.TRUE, label: "true" },
      { id: HANDLE.FALSE, label: "false" },
    ],
  },
  state: { hasInput: true, outputs: [{ id: HANDLE.OUTPUT, label: "" }] },
};

// ---------------------------------------------------------------------------
// Default data factories
// ---------------------------------------------------------------------------

function defaultTrigger(): TriggerBlockData {
  return {
    kind: "trigger",
    label: "Trigger",
    triggerKind: "command",
    value: "/start",
    caseInsensitive: false,
    aliases: [],
    groupOnly: false,
  };
}

function defaultMessage(): MessageBlockData {
  return {
    kind: "message",
    label: "Message",
    text: "Hello! 👋",
    parseMode: "Markdown",
    media: [],
    captureMessageId: "",
  };
}

function defaultKeyboard(): KeyboardBlockData {
  return {
    kind: "keyboard",
    label: "Keyboard",
    keyboardType: "inline",
    text: "Choose an option:",
    parseMode: "Markdown",
    rows: [
      [
        { id: createWorkflowId("btn"), text: "Yes", action: "callback", value: "confirm" },
        { id: createWorkflowId("btn"), text: "No", action: "callback", value: "cancel" },
      ],
    ],
    resize: true,
    oneTime: false,
    placeholder: "",
  };
}

function defaultApi(): ApiBlockData {
  return {
    kind: "api",
    label: "API request",
    method: "GET",
    url: "https://api.example.com/data",
    headers: [],
    body: "",
    bindTo: "apiResponse",
    timeoutMs: 10_000,
    errorMessage: "Sorry, something went wrong while fetching that.",
    haltOnError: true,
  };
}

function defaultCondition(): ConditionBlockData {
  return {
    kind: "condition",
    label: "Condition",
    subject: "message",
    variable: "",
    operator: "contains",
    compareValue: "price",
    caseInsensitive: true,
  };
}

function defaultState(): StateBlockData {
  return {
    kind: "state",
    label: "Capture input",
    variable: "user_input",
    prompt: "What's your email address?",
    validator: "none",
    required: true,
    errorMessage: "That doesn't look right. Please try again.",
    scope: "user",
    confirmMessage: "",
  };
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export type BlockDefinition = {
  kind: BlockKind;
  category: BlockCategory;
  title: string;
  summary: string;
  icon: LucideIcon;
  /**
   * Literal Tailwind classes. They must appear verbatim in source for the Tailwind
   * scanner to emit them — never build these strings dynamically.
   */
  accent: {
    border: string;
    background: string;
    text: string;
    dot: string;
  };
  createDefaultData: () => WorkflowNodeData;
};

export const BLOCK_CATALOG: BlockDefinition[] = [
  {
    kind: "trigger",
    category: "entry",
    title: "Trigger",
    summary: "Listens for a slash command, keyword, regex, inline query or the wildcard fallback.",
    icon: Zap,
    accent: {
      border: "border-l-primary",
      background: "bg-primary/10",
      text: "text-primary",
      dot: "bg-primary",
    },
    createDefaultData: defaultTrigger,
  },
  {
    kind: "message",
    category: "content",
    title: "Message response",
    summary: "Sends text with formatting, plus images, video, audio or documents.",
    icon: MessageSquare,
    accent: {
      border: "border-l-success",
      background: "bg-success/10",
      text: "text-success",
      dot: "bg-success",
    },
    createDefaultData: defaultMessage,
  },
  {
    kind: "keyboard",
    category: "content",
    title: "Keyboard",
    summary: "Inline or reply keyboard with URL links, callback data or web app links.",
    icon: KeyboardIcon,
    accent: {
      border: "border-l-chart-5",
      background: "bg-chart-5/10",
      text: "text-chart-5",
      dot: "bg-chart-5",
    },
    createDefaultData: defaultKeyboard,
  },
  {
    kind: "api",
    category: "content",
    title: "API fetch",
    summary: "Calls an external webhook or REST API and binds the JSON response to a variable.",
    icon: Globe,
    accent: {
      border: "border-l-chart-3",
      background: "bg-chart-3/10",
      text: "text-chart-3",
      dot: "bg-chart-3",
    },
    createDefaultData: defaultApi,
  },
  {
    kind: "condition",
    category: "logic",
    title: "Condition / branch",
    summary: "Splits the flow on an if/else rule, e.g. message contains \"price\".",
    icon: GitBranch,
    accent: {
      border: "border-l-warning",
      background: "bg-warning/10",
      text: "text-warning",
      dot: "bg-warning",
    },
    createDefaultData: defaultCondition,
  },
  {
    kind: "state",
    category: "data",
    title: "State / form input",
    summary: "Pauses, captures the user's next message with validation, and saves it to a variable.",
    icon: Braces,
    accent: {
      border: "border-l-chart-4",
      background: "bg-chart-4/10",
      text: "text-chart-4",
      dot: "bg-chart-4",
    },
    createDefaultData: defaultState,
  },
];

export const BLOCK_BY_KIND: Record<BlockKind, BlockDefinition> = BLOCK_CATALOG.reduce(
  (accumulator, definition) => {
    accumulator[definition.kind] = definition;
    return accumulator;
  },
  {} as Record<BlockKind, BlockDefinition>,
);

/** Palette sections, in display order. */
export const CATEGORY_ORDER: BlockCategory[] = ["entry", "content", "logic", "data"];

export { BLOCK_CATEGORY_LABEL };

// ---------------------------------------------------------------------------
// Node factory
// ---------------------------------------------------------------------------

export function createNodeFromKind(
  kind: BlockKind,
  position: { x: number; y: number },
): WorkflowNode {
  const definition = BLOCK_BY_KIND[kind];
  const data = definition.createDefaultData();

  // Each block type carries a different data shape; the cast is the single place
  // where that union is narrowed by construction rather than by inspection.
  return {
    id: createWorkflowId(kind),
    type: kind,
    position,
    data,
  } as WorkflowNode;
}

// ---------------------------------------------------------------------------
// Field-level validation
// ---------------------------------------------------------------------------

export type FieldIssue = {
  field: string;
  message: string;
  severity: ValidationSeverity;
};

/**
 * Validate one block's own fields, independent of the graph.
 *
 * Graph-level problems (cycles, orphans, missing triggers) live in the compiler,
 * which has the edges. This function answers only "is this node configured?".
 */
export function validateBlockData(data: WorkflowNodeData): FieldIssue[] {
  const issues: FieldIssue[] = [];

  switch (data.kind) {
    case "trigger": {
      const value = data.value.trim();
      if (!value) {
        issues.push({
          field: "value",
          severity: "error",
          message: "A trigger needs a value, e.g. /start or Help.",
        });
      }

      if (data.triggerKind === "command" && value) {
        const normalised = value.startsWith("/") ? value : `/${value}`;
        if (!/^\/[A-Za-z0-9_]+$/.test(normalised)) {
          issues.push({
            field: "value",
            severity: "error",
            message: "Telegram commands allow letters, digits and underscores only.",
          });
        }
      }

      if (data.triggerKind === "regex" && value) {
        try {
          new RegExp(value);
        } catch (error) {
          issues.push({
            field: "value",
            severity: "error",
            message: `Invalid regex: ${error instanceof Error ? error.message : "parse error"}`,
          });
        }
      }

      if (data.triggerKind === "wildcard") {
        issues.push({
          field: "value",
          severity: "warning",
          message:
            "Only one wildcard is allowed per bot. A second one would be ignored at deploy time.",
        });
      }
      break;
    }

    case "message": {
      const hasMedia = data.media.some((item) => item.source.trim().length > 0);
      if (!data.text.trim() && !hasMedia) {
        issues.push({
          field: "text",
          severity: "error",
          message: "A message needs either text or at least one attachment.",
        });
      }
      if (data.text.length > 10_000) {
        issues.push({
          field: "text",
          severity: "error",
          message: `Text is ${data.text.length.toLocaleString()} characters; TeleBotHost caps a single message at 10,000.`,
        });
      }
      for (const item of data.media) {
        if (!item.source.trim()) {
          issues.push({
            field: "media",
            severity: "error",
            message: `A ${item.kind} attachment has no URL or file_id.`,
          });
        }
      }
      break;
    }

    case "keyboard": {
      if (!data.text.trim()) {
        issues.push({
          field: "text",
          severity: "error",
          message: "Telegram cannot send buttons without a message, so text is required.",
        });
      }

      const buttons = data.rows.flat().filter((button) => button.text.trim().length > 0);
      if (buttons.length === 0) {
        issues.push({
          field: "rows",
          severity: "error",
          message: "Add at least one button.",
        });
      }

      for (const button of buttons) {
        const value = button.value.trim();
        if (!value) {
          issues.push({
            field: "rows",
            severity: "error",
            message: `Button "${button.text.trim()}" has no ${button.action === "url" ? "URL" : button.action === "webapp" ? "web app URL" : "callback data"}.`,
          });
          continue;
        }
        if ((button.action === "url" || button.action === "webapp") && !/^https?:\/\//i.test(value)) {
          issues.push({
            field: "rows",
            severity: "error",
            message: `Button "${button.text.trim()}" needs a URL starting with http:// or https://.`,
          });
        }
        if (button.action === "callback" && value.length > 64) {
          issues.push({
            field: "rows",
            severity: "error",
            message: `Callback data is limited to 64 bytes by Telegram; "${button.text.trim()}" is ${value.length}.`,
          });
        }
        if (data.keyboardType === "reply" && button.action !== "callback") {
          issues.push({
            field: "rows",
            severity: "warning",
            message: `Reply keyboards cannot open links — "${button.text.trim()}" will just send its label as text. Use an inline keyboard for URL buttons.`,
          });
        }
      }
      break;
    }

    case "api": {
      const url = data.url.trim();
      if (!url) {
        issues.push({ field: "url", severity: "error", message: "An API block needs a URL." });
      } else if (!/^https?:\/\//i.test(url)) {
        issues.push({
          field: "url",
          severity: "error",
          message: "The URL must start with http:// or https://.",
        });
      }

      if (!data.bindTo.trim()) {
        issues.push({
          field: "bindTo",
          severity: "error",
          message: "Name the variable the response should be bound to.",
        });
      } else if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(data.bindTo.trim())) {
        issues.push({
          field: "bindTo",
          severity: "error",
          message: `"${data.bindTo}" is not a valid JavaScript identifier.`,
        });
      }

      for (const header of data.headers) {
        if (!header.name.trim()) {
          issues.push({
            field: "headers",
            severity: "error",
            message: "Every header needs a name.",
          });
        }
        if (!header.secret && !header.value.trim()) {
          issues.push({
            field: "headers",
            severity: "error",
            message: `Header "${header.name || "(unnamed)"}" has no value.`,
          });
        }
      }

      const body = data.body.trim();
      if (body && data.method !== "GET" && data.method !== "DELETE") {
        try {
          JSON.parse(body);
        } catch {
          issues.push({
            field: "body",
            severity: "error",
            message: "The request body must be valid JSON.",
          });
        }
      }

      if (data.timeoutMs < 1000 || data.timeoutMs > 60_000) {
        issues.push({
          field: "timeoutMs",
          severity: "warning",
          message: "A timeout outside 1s–60s is unusual; Telegram bots are killed well before 60s.",
        });
      }
      break;
    }

    case "condition": {
      if (data.subject === "variable" && !data.variable.trim()) {
        issues.push({
          field: "variable",
          severity: "error",
          message: "Pick which variable this condition should read.",
        });
      }

      const needsComparison = !["isTruthy", "isEmpty"].includes(data.operator);
      if (needsComparison && !data.compareValue.trim()) {
        issues.push({
          field: "compareValue",
          severity: "error",
          message: "This operator needs a value to compare against.",
        });
      }

      if (data.operator === "matchesRegex" && data.compareValue.trim()) {
        try {
          new RegExp(data.compareValue);
        } catch (error) {
          issues.push({
            field: "compareValue",
            severity: "error",
            message: `Invalid regex: ${error instanceof Error ? error.message : "parse error"}`,
          });
        }
      }
      break;
    }

    case "state": {
      const variable = data.variable.trim();
      if (!variable) {
        issues.push({
          field: "variable",
          severity: "error",
          message: "Give the captured value a variable name.",
        });
      } else if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(variable)) {
        issues.push({
          field: "variable",
          severity: "error",
          message: `"${variable}" is not a valid variable name.`,
        });
      }

      if (!data.prompt.trim()) {
        issues.push({
          field: "prompt",
          severity: "error",
          message: "The user needs a question to answer.",
        });
      }
      break;
    }
  }

  // Variable-reference checking needs the whole graph (to know what is defined), so
  // it lives in the compiler rather than here.
  return issues;
}

/** Variables this block writes, so the graph can resolve references. */
export function collectProducedVariables(data: WorkflowNodeData): string[] {
  switch (data.kind) {
    case "api":
      return data.bindTo.trim() ? [data.bindTo.trim()] : [];
    case "state":
      return data.variable.trim() ? [data.variable.trim()] : [];
    case "message":
      return data.captureMessageId.trim() ? [data.captureMessageId.trim()] : [];
    default:
      return [];
  }
}

/** `{{var}}` references appearing in a block's text fields. */
export function collectVariableReferences(data: WorkflowNodeData): string[] {
  const found = new Set<string>();
  const scan = (text: string) => {
    for (const match of text.matchAll(/\{\{\s*([A-Za-z0-9_$.]+)\s*\}\}/g)) {
      if (match[1]) found.add(match[1]);
    }
  };

  switch (data.kind) {
    case "message":
      scan(data.text);
      for (const item of data.media) scan(item.caption);
      break;
    case "keyboard":
      scan(data.text);
      break;
    case "api":
      scan(data.url);
      scan(data.body);
      for (const header of data.headers) scan(header.value);
      break;
    case "condition":
      scan(data.compareValue);
      break;
    case "state":
      scan(data.prompt);
      scan(data.confirmMessage);
      break;
    case "trigger":
      break;
  }

  return [...found];
}
