/**
 * `compileCanvasToTeleBotHostScript(nodes, edges)`
 *
 * Lowers a visual node graph into TeleBotHost (TBL) commands.
 *
 * The central problem this solves
 * ------------------------------
 * TBL has no persistent graph runtime. It is a **command** platform: a user sends a
 * message, TBL matches exactly one command, runs that command's script once, and
 * goes back to sleep. So a node graph cannot be "interpreted" — it has to be
 * *flattened* into self-contained command scripts.
 *
 * This compiler therefore:
 *
 *  1. Treats every **Trigger** node as the root of one command.
 *  2. Walks downstream from that trigger, emitting statements in order.
 *  3. Inlines **Condition** nodes as real `if/else` blocks (recursively).
 *  4. Turns **State** nodes into stage boundaries, because capturing input requires
 *     `need_reply` — which re-runs the *entire* command on the user's next message.
 *     A step counter in `db` makes the command resume at the right place instead of
 *     replaying everything from the top.
 *  5. Folds every **regex** and **wildcard** trigger into a single `*` dispatcher
 *     command, because TBL routes on exact names only and permits one wildcard.
 *
 * Variable scoping deserves a note. Variables written by an **API** or **Message**
 * block are ordinary `let` bindings and die at the end of the execution. Variables
 * written by a **State** block are persisted in `db` and survive the pause. The
 * compiler tracks which is which, resolves `{{references}}` to the right accessor,
 * and warns when a local variable is referenced across a stage boundary — where it
 * would silently read `null`.
 */

import {
  HANDLE,
  type ApiBlockData,
  type CompiledWorkflowCommand,
  type ConditionBlockData,
  type KeyboardBlockData,
  type MessageBlockData,
  type StateBlockData,
  type TriggerBlockData,
  type ValidationIssue,
  type WorkflowCompileResult,
  type WorkflowEdge,
  type WorkflowNode,
} from "@/types/workflow";
import { BLOCK_BY_KIND, collectProducedVariables, validateBlockData } from "./workflow-blocks";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** TBL globals and reserved words a produced variable must not shadow. */
const RESERVED_NAMES = new Set([
  "Bot", "Api", "db", "user", "chat", "message", "params", "update", "update_type",
  "request", "plan", "owner", "bot", "process", "env", "options", "tbl_options",
  "content", "msg", "error", "http_response", "response", "headers", "cookies",
  "await", "async", "function", "return", "let", "const", "var", "if", "else",
  "for", "while", "new", "class", "this", "null", "undefined", "true", "false",
]);

/** Guard against pathological graphs producing unbounded output. */
const MAX_EMIT_DEPTH = 64;

/**
 * TBL globals that a `{{reference}}` may legitimately point at.
 *
 * These are provided by TeleBotHost in every command execution, so they resolve
 * even though no block in the graph produces them. Without this list,
 * `{{user.first_name}}` would be left as literal text.
 */
const TBL_GLOBALS = new Set([
  "update",
  "update_type",
  "request",
  "message",
  "user",
  "chat",
  "bot",
  "owner",
  "plan",
  "params",
  "options",
  "tbl_options",
  "content",
  "msg",
  "error",
  "http_response",
  "process",
]);

// ---------------------------------------------------------------------------
// Small codegen helpers
// ---------------------------------------------------------------------------

/** Emit a JavaScript string literal safely. */
function js(value: string): string {
  return JSON.stringify(value);
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.trim().length === 0 ? line : pad + line))
    .join("\n");
}

/**
 * Which storage a produced variable uses.
 *
 * `state` means it is persisted in the workflow record and survives a pause;
 * `local` means it is an ordinary binding that dies with the command execution.
 */
type VariableKind = "state" | "local";

type VariableTable = Map<string, VariableKind>;

/**
 * How a variable name is read at runtime.
 *
 * - State variables live in the persisted record (`__wf.vars.x`), because they must
 *   survive the pause between stages.
 * - Everything else is an ordinary JS path. Dotted paths use optional chaining so a
 *   missing parent (`user` is null on some update types) cannot throw.
 */
function variableAccessor(name: string, table: VariableTable): string {
  if (table.get(name) === "state") {
    // State variables are validated to be simple identifiers.
    return `__wf.vars.${name}`;
  }

  if (name.includes(".")) {
    const [head, ...rest] = name.split(".");
    return [head, ...rest.map((part) => `?.${part}`)].join("");
  }

  return name;
}

/** Whether a `{{reference}}` can be resolved to a runtime value. */
function isResolvable(reference: string, table: VariableTable): boolean {
  if (table.has(reference)) return true;

  const root = reference.split(".")[0] ?? reference;
  // A field of a known variable, e.g. {{apiResponse.status}}.
  if (table.has(root)) return true;
  // A TBL global, e.g. {{user.first_name}}.
  if (TBL_GLOBALS.has(root)) return true;

  return false;
}

/**
 * Turn `"Hi {{user_name}}, you have {{count}} items"` into a JavaScript string
 * expression. Unknown references are left as literal text so a typo is visible in
 * the output rather than silently becoming `undefined`.
 */
function buildTemplateExpression(
  text: string,
  table: VariableTable,
  stateKey: string,
): string {
  const pattern = /\{\{\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*\}\}/g;
  const parts: string[] = [];

  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const before = text.slice(cursor, match.index);
    if (before) parts.push(js(before));

    const name = match[1] ?? "";
    if (isResolvable(name, table)) {
      parts.push(`String(${variableAccessor(name, table)} ?? "")`);
    } else if (name.startsWith("env.")) {
      parts.push(`String(process.env.${name.slice(4)} ?? "")`);
    } else {
      // Unresolved — keep the literal so the mistake is visible.
      parts.push(js(match[0]));
    }

    cursor = match.index + match[0].length;
  }

  const tail = text.slice(cursor);
  if (tail) parts.push(js(tail));

  if (parts.length === 0) return '""';
  return parts.join(" + ");
}

// ---------------------------------------------------------------------------
// Graph indexing
// ---------------------------------------------------------------------------

type GraphIndex = {
  byId: Map<string, WorkflowNode>;
  /** nodeId -> outgoing edges */
  outgoing: Map<string, WorkflowEdge[]>;
  /** nodeId -> incoming edges */
  incoming: Map<string, WorkflowEdge[]>;
};

function indexGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): GraphIndex {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, WorkflowEdge[]>();

  for (const node of nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }

  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge);
    incoming.get(edge.target)?.push(edge);
  }

  return { byId, outgoing, incoming };
}

/** Follow the default output handle from a node. */
function nextNodeId(index: GraphIndex, nodeId: string, handle?: string): string | null {
  const candidates = index.outgoing.get(nodeId) ?? [];
  const edge = handle
    ? candidates.find((candidate) => (candidate.sourceHandle ?? HANDLE.OUTPUT) === handle)
    : candidates.find((candidate) => (candidate.sourceHandle ?? HANDLE.OUTPUT) === HANDLE.OUTPUT);

  return edge?.target ?? null;
}

// ---------------------------------------------------------------------------
// Graph-level validation
// ---------------------------------------------------------------------------

function detectCycles(index: GraphIndex): string[][] {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;

  const colour = new Map<string, number>();
  for (const id of index.byId.keys()) colour.set(id, WHITE);

  const cycles: string[][] = [];
  const stack: string[] = [];

  function visit(id: string) {
    colour.set(id, GREY);
    stack.push(id);

    for (const edge of index.outgoing.get(id) ?? []) {
      const state = colour.get(edge.target);
      if (state === GREY) {
        const start = stack.indexOf(edge.target);
        cycles.push(stack.slice(start).concat(edge.target));
      } else if (state === WHITE) {
        visit(edge.target);
      }
    }

    stack.pop();
    colour.set(id, BLACK);
  }

  for (const id of index.byId.keys()) {
    if (colour.get(id) === WHITE) visit(id);
  }

  return cycles;
}

function collectGraphIssues(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  index: GraphIndex,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (nodes.length === 0) {
    issues.push({
      nodeId: "",
      severity: "error",
      message: "The canvas is empty. Drag a Trigger block in to start.",
    });
    return issues;
  }

  // -- per-field validation ------------------------------------------------
  for (const node of nodes) {
    for (const fieldIssue of validateBlockData(node.data)) {
      issues.push({
        nodeId: node.id,
        severity: fieldIssue.severity,
        field: fieldIssue.field,
        message: `${node.data.label}: ${fieldIssue.message}`,
      });
    }
  }

  // -- dangling edges ------------------------------------------------------
  for (const edge of edges) {
    if (!index.byId.has(edge.source) || !index.byId.has(edge.target)) {
      issues.push({
        nodeId: edge.source,
        severity: "error",
        message: `An edge points at a block that no longer exists (${edge.source} → ${edge.target}).`,
      });
    }
  }

  // -- cycles --------------------------------------------------------------
  for (const cycle of detectCycles(index)) {
    const labels = cycle
      .map((id) => index.byId.get(id)?.data.label ?? id)
      .join(" → ");
    issues.push({
      nodeId: cycle[0] ?? "",
      severity: "error",
      message: `Cycle detected: ${labels}. TBL commands run once per message, so a loop would never terminate.`,
    });
  }

  // -- triggers ------------------------------------------------------------
  const triggers = nodes.filter((node) => node.type === "trigger");

  if (triggers.length === 0) {
    issues.push({
      nodeId: "",
      severity: "error",
      message: "No Trigger block. Every workflow needs at least one entry point.",
    });
  }

  for (const trigger of triggers) {
    const outs = index.outgoing.get(trigger.id) ?? [];
    if (outs.length === 0) {
      issues.push({
        nodeId: trigger.id,
        severity: "error",
        message: `${trigger.data.label}: this trigger has nothing connected to it, so it would do nothing.`,
      });
    }
  }

  // Duplicate trigger names produce one command each with the same name, and TBL
  // matches exactly one — the others would be dead.
  const seenNames = new Map<string, WorkflowNode>();
  for (const trigger of triggers) {
    const data = trigger.data as TriggerBlockData;
    const name = triggerName(data);
    if (!name) continue;
    const key = data.caseInsensitive ? name.toLowerCase() : name;
    const previous = seenNames.get(key);
    if (previous) {
      issues.push({
        nodeId: trigger.id,
        severity: "error",
        message: `Trigger "${name}" is already used by "${previous.data.label}". TBL matches exactly one command per message.`,
      });
    } else {
      seenNames.set(key, trigger);
    }
  }

  // -- orphans / unreachable ----------------------------------------------
  const reachable = new Set<string>();
  const queue = triggers.map((trigger) => trigger.id);
  while (queue.length > 0) {
    const id = queue.pop();
    if (!id || reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of index.outgoing.get(id) ?? []) queue.push(edge.target);
  }

  for (const node of nodes) {
    if (node.type === "trigger") continue;

    const incoming = index.incoming.get(node.id) ?? [];
    if (incoming.length === 0) {
      issues.push({
        nodeId: node.id,
        severity: "error",
        message: `${node.data.label}: no incoming connection, so it is unreachable and will not be compiled.`,
      });
    } else if (!reachable.has(node.id)) {
      issues.push({
        nodeId: node.id,
        severity: "warning",
        message: `${node.data.label}: not reachable from any trigger.`,
      });
    } else if (incoming.length > 1) {
      issues.push({
        nodeId: node.id,
        severity: "warning",
        message: `${node.data.label}: has ${incoming.length} incoming connections, so its code is inlined once per path (duplicated).`,
      });
    }
  }

  // -- condition branches --------------------------------------------------
  for (const node of nodes) {
    if (node.type !== "condition") continue;
    const outs = index.outgoing.get(node.id) ?? [];
    const hasTrue = outs.some((edge) => (edge.sourceHandle ?? HANDLE.OUTPUT) === HANDLE.TRUE);
    const hasFalse = outs.some((edge) => (edge.sourceHandle ?? HANDLE.OUTPUT) === HANDLE.FALSE);

    if (!hasTrue) {
      issues.push({
        nodeId: node.id,
        severity: "warning",
        message: `${node.data.label}: the "true" branch is not connected, so a matching message does nothing.`,
      });
    }
    if (!hasFalse) {
      issues.push({
        nodeId: node.id,
        severity: "warning",
        message: `${node.data.label}: the "false" branch is not connected, so a non-matching message does nothing.`,
      });
    }
  }

  // -- wildcard count ------------------------------------------------------
  const wildcards = triggers.filter((node) => (node.data as TriggerBlockData).triggerKind === "wildcard");
  if (wildcards.length > 1) {
    issues.push({
      nodeId: wildcards[1]?.id ?? "",
      severity: "error",
      message: `Only one wildcard (*) trigger is allowed per bot — you have ${wildcards.length}.`,
    });
  }

  // -- variables -----------------------------------------------------------
  const produced = new Map<string, VariableKind>();
  for (const node of nodes) {
    for (const name of collectProducedVariables(node.data)) {
      if (RESERVED_NAMES.has(name)) {
        issues.push({
          nodeId: node.id,
          severity: "error",
          field: "variable",
          message: `${node.data.label}: "${name}" is a TBL global. Rename the variable — shadowing it would break the generated script.`,
        });
        continue;
      }
      produced.set(name, node.type === "state" ? "state" : "local");
    }
  }

  // Unknown `{{reference}}` — the most common authoring mistake.
  for (const node of nodes) {
    for (const reference of collectReferences(node.data)) {
      const root = reference.split(".")[0] ?? reference;
      if (RESERVED_NAMES.has(root)) continue;
      if (reference.startsWith("env.")) continue;
      if (produced.has(root) || produced.has(reference)) continue;

      issues.push({
        nodeId: node.id,
        severity: "warning",
        field: "text",
        message: `${node.data.label}: "{{${reference}}}" is not written by any block, so it will render as literal text.`,
      });
    }
  }

  return issues;
}

/** `{{...}}` references inside a block's text fields. */
function collectReferences(data: WorkflowNode["data"]): string[] {
  const found = new Set<string>();
  const scan = (text: string) => {
    for (const match of text.matchAll(/\{\{\s*([A-Za-z_$][A-Za-z0-9_$.]*)\s*\}\}/g)) {
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

// ---------------------------------------------------------------------------
// Trigger lowering
// ---------------------------------------------------------------------------

function triggerName(data: TriggerBlockData): string {
  const value = data.value.trim();

  switch (data.triggerKind) {
    case "wildcard":
      return "*";
    case "inline":
      // TBL routes inline queries through a dedicated update-type handler rather
      // than the normal name match.
      return "/handle_inline_query";
    case "command":
      if (!value) return "";
      return value.startsWith("/") ? value : `/${value}`;
    case "keyword":
    case "regex":
    case "callback":
      return value;
    default:
      return "";
  }
}

/** Regex and wildcard triggers share the single `*` dispatcher command. */
function isDispatcherTrigger(data: TriggerBlockData): boolean {
  return data.triggerKind === "regex" || data.triggerKind === "wildcard";
}

// ---------------------------------------------------------------------------
// Block code emission
// ---------------------------------------------------------------------------

type EmitContext = {
  table: VariableTable;
  stateKey: string;
  /** Counter so generated temporaries never collide. */
  nextTemp: () => number;
};

function emitMessage(data: MessageBlockData, context: EmitContext): string[] {
  const lines: string[] = [];
  const textExpression = buildTemplateExpression(data.text, context.table, context.stateKey);
  const hasText = data.text.trim().length > 0;
  const media = data.media.filter((item) => item.source.trim().length > 0);

  for (const item of media) {
    const method =
      item.kind === "photo"
        ? "sendPhoto"
        : item.kind === "document"
          ? "sendDocument"
          : item.kind === "video"
            ? "sendVideo"
            : "sendAudio";

    const field =
      item.kind === "photo"
        ? "photo"
        : item.kind === "document"
          ? "document"
          : item.kind === "video"
            ? "video"
            : "audio";

    const payload: Record<string, unknown> = {
      [field]: buildTemplateExpression(item.source, context.table, context.stateKey),
    };

    if (item.caption.trim()) {
      payload.caption = buildTemplateExpression(item.caption, context.table, context.stateKey);
      payload.parse_mode = data.parseMode;
    }

    // The payload holds JS expressions, so it cannot be JSON.stringify'd wholesale.
    const entries = Object.entries(payload)
      .map(([key, value]) =>
        typeof value === "string" && value.startsWith('"')
          ? `${key}: ${value}`
          : `${key}: ${JSON.stringify(value)}`,
      )
      .join(", ");

    lines.push(`await Api.${method}({ ${entries} })`);
  }

  if (!hasText) return lines;

  if (data.captureMessageId.trim()) {
    lines.push(
      `${data.captureMessageId.trim()} = await Api.sendMessage({ text: ${textExpression}, parse_mode: ${js(data.parseMode)} })`,
    );
  } else {
    lines.push(
      `await Api.sendMessage({ text: ${textExpression}, parse_mode: ${js(data.parseMode)} })`,
    );
  }

  return lines;
}

function emitKeyboard(data: KeyboardBlockData, context: EmitContext): string[] {
  const rows = data.rows
    .map((row) => row.filter((button) => button.text.trim().length > 0))
    .filter((row) => row.length > 0);

  const textExpression = buildTemplateExpression(data.text, context.table, context.stateKey);

  if (data.keyboardType === "inline") {
    const rowsLiteral = JSON.stringify(
      rows.map((row) =>
        row.map((button) => {
          const text = button.text.trim();
          const value = button.value.trim();
          if (button.action === "url") return { text, url: value };
          if (button.action === "webapp") return { text, web_app: { url: value } };
          return { text, callback_data: value };
        }),
      ),
    );

    return [
      `await Api.sendMessage({`,
      `  text: ${textExpression},`,
      `  parse_mode: ${js(data.parseMode)},`,
      `  reply_markup: { inline_keyboard: ${rowsLiteral} }`,
      `})`,
    ];
  }

  // Reply keyboard: buttons send their label as ordinary text.
  const rowsLiteral = JSON.stringify(
    rows.map((row) => row.map((button) => ({ text: button.text.trim() }))),
  );

  const markup: Record<string, unknown> = {
    keyboard: JSON.parse(rowsLiteral),
    resize_keyboard: data.resize,
  };
  if (data.oneTime) markup.one_time_keyboard = true;
  if (data.placeholder.trim()) markup.input_field_placeholder = data.placeholder.trim();

  return [
    `await Api.sendMessage({`,
    `  text: ${textExpression},`,
    `  parse_mode: ${js(data.parseMode)},`,
    `  reply_markup: ${JSON.stringify(markup)}`,
    `})`,
  ];
}

function emitApi(data: ApiBlockData, context: EmitContext): string[] {
  const index = context.nextTemp();
  const resultVar = `__api_${index}`;
  const responseVar = `__res_${index}`;
  const errorVar = `__err_${index}`;

  const urlExpression = buildTemplateExpression(data.url, context.table, context.stateKey);

  const headerEntries = data.headers
    .filter((header) => header.name.trim().length > 0)
    .map((header) => {
      const name = header.name.trim();
      // Secrets are read from TeleBotHost's environment variables at runtime, so the
      // value never lands in generated source.
      if (header.secret) {
        return `${js(name)}: String(process.env.${name.replace(/[^A-Za-z0-9_]/g, "_")} ?? "")`;
      }
      return `${js(name)}: ${buildTemplateExpression(header.value, context.table, context.stateKey)}`;
    });

  const hasBody = data.method !== "GET" && data.body.trim().length > 0;
  const headerLines = [
    ...(hasBody ? [`"Content-Type": "application/json"`] : []),
    ...headerEntries,
  ];

  const lines: string[] = [
    `let ${resultVar} = null`,
    `try {`,
    `  const ${responseVar} = await fetch(${urlExpression}, {`,
    `    method: ${js(data.method)},`,
  ];

  if (headerLines.length > 0) {
    lines.push(`    headers: { ${headerLines.join(", ")} },`);
  }

  if (hasBody) {
    const bodyExpression = buildTemplateExpression(data.body, context.table, context.stateKey);
    lines.push(`    body: ${bodyExpression},`);
  }

  lines.push(`  })`);
  lines.push(`  ${resultVar} = ${responseVar}.ok ? await ${responseVar}.json().catch(() => null) : null`);
  lines.push(`} catch (${errorVar}) {`);
  lines.push(`  ${resultVar} = null`);
  lines.push(`}`);

  const bindTo = data.bindTo.trim();
  if (bindTo) {
    lines.push(`${bindTo} = ${resultVar}`);
  }

  if (data.haltOnError) {
    lines.push(`if (${bindTo || resultVar} === null) {`);
    if (data.errorMessage.trim()) {
      lines.push(
        `  Bot.sendMessage(${buildTemplateExpression(data.errorMessage, context.table, context.stateKey)})`,
      );
    }
    lines.push(`  return`);
    lines.push(`}`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Condition expressions
// ---------------------------------------------------------------------------

function buildConditionExpression(data: ConditionBlockData, context: EmitContext): string {
  const subject = (() => {
    switch (data.subject) {
      case "message":
        return `String(message || "")`;
      case "params":
        return `String(params || "")`;
      case "chatType":
        return `String((chat && chat.type) || "")`;
      case "variable":
      default:
        return data.variable.trim()
          ? `String(${variableAccessor(data.variable.trim(), context.table)} ?? "")`
          : '""';
    }
  })();

  const compare = buildTemplateExpression(data.compareValue, context.table, context.stateKey);

  // For message/params/variable comparisons, case-insensitivity is applied by
  // lowercasing both sides — TBL has no locale-aware collation here.
  const left = data.caseInsensitive ? `${subject}.toLowerCase()` : subject;
  const right = data.caseInsensitive ? `${compare}.toLowerCase()` : compare;

  switch (data.operator) {
    case "contains":
      return `${left}.includes(${right})`;
    case "notContains":
      return `!${left}.includes(${right})`;
    case "equals":
      return `${left} === ${right}`;
    case "startsWith":
      return `${left}.startsWith(${right})`;
    case "endsWith":
      return `${left}.endsWith(${right})`;
    case "matchesRegex":
      return `new RegExp(${compare}, ${js(data.caseInsensitive ? "i" : "")}).test(${subject})`;
    case "isTruthy": {
      // Read the raw value, not the stringified form, so 0 and "" are falsy.
      const raw =
        data.subject === "variable" && data.variable.trim()
          ? variableAccessor(data.variable.trim(), context.table)
          : subject;
      return `Boolean(${raw})`;
    }
    case "isEmpty":
      return `${left}.trim().length === 0`;
    case "greaterThan":
      return `Number(${subject}) > Number(${compare})`;
    case "lessThan":
      return `Number(${subject}) < Number(${compare})`;
    default:
      return "false";
  }
}

// ---------------------------------------------------------------------------
// Chain emission
// ---------------------------------------------------------------------------

type Stage = {
  /** Statements executed at the start of this stage (after any resume capture). */
  statements: string[];
  /** The state block whose answer this stage consumes, if any. */
  resumeFrom: StateBlockData | null;
  /** The state block that ends this stage by pausing, if any. */
  pauseAt: StateBlockData | null;
  /** True for the terminal stage, which clears the persisted state. */
  isFinal: boolean;
};

type ChainResult = {
  stages: Stage[];
  issues: ValidationIssue[];
  /** Node ids that contributed code. */
  usedNodeIds: string[];
};

/**
 * Walk forward from a starting node, flattening the chain into stages.
 *
 * `startId` is the first **action** node, never the trigger itself — a trigger is
 * the root of the command and has no code of its own. Passing the trigger here
 * would hit the "trigger reached downstream" case below and stop immediately.
 *
 * A Condition ends the linear walk because it fans out: both branches are inlined
 * as a single if/else statement, and execution after the condition resumes from
 * whichever branch ran. A State block ends a *stage* because it pauses execution.
 */
function emitChain(
  startId: string | null,
  index: GraphIndex,
  context: EmitContext,
  issues: ValidationIssue[],
  used: Set<string>,
  options: { allowState: boolean; depth: number },
): Stage[] {
  const stages: Stage[] = [];
  let currentStage: Stage = { statements: [], resumeFrom: null, pauseAt: null, isFinal: false };

  const pathStack = new Set<string>();
  let currentId: string | null = startId;

  while (currentId) {
    if (options.depth > MAX_EMIT_DEPTH) break;

    if (pathStack.has(currentId)) {
      // Cycles are reported globally; stop here so emission cannot hang.
      break;
    }
    pathStack.add(currentId);

    const node = index.byId.get(currentId);
    if (!node) break;

    used.add(node.id);

    switch (node.data.kind) {
      case "trigger":
        // A trigger reached downstream is a second entry point; its own command
        // handles it, so this edge is not part of the current chain.
        issues.push({
          nodeId: node.id,
          severity: "warning",
          message: `"${node.data.label}" is a Trigger connected downstream of another block. It compiles to its own command, so this connection is ignored.`,
        });
        currentId = null;
        break;

      case "message":
        currentStage.statements.push(...emitMessage(node.data, context));
        currentId = nextNodeId(index, node.id);
        break;

      case "keyboard":
        currentStage.statements.push(...emitKeyboard(node.data, context));
        currentId = nextNodeId(index, node.id);
        break;

      case "api":
        currentStage.statements.push(...emitApi(node.data, context));
        currentId = nextNodeId(index, node.id);
        break;

      case "condition": {
        const condition = buildConditionExpression(node.data, context);

        const trueStages = emitBranch(
          nextNodeId(index, node.id, HANDLE.TRUE),
          index,
          context,
          issues,
          used,
          options,
        );
        const falseStages = emitBranch(
          nextNodeId(index, node.id, HANDLE.FALSE),
          index,
          context,
          issues,
          used,
          options,
        );

        const trueBody = trueStages.join("\n");
        const falseBody = falseStages.join("\n");

        const block: string[] = [`if (${condition}) {`];
        block.push(trueBody ? indent(trueBody, 2) : "  // true branch not connected");
        if (falseBody) {
          block.push(`} else {`);
          block.push(indent(falseBody, 2));
        }
        block.push(`}`);

        currentStage.statements.push(...block);

        // A condition fans out; nothing linear follows it in this walk.
        currentId = null;
        break;
      }

      case "state": {
        if (!options.allowState) {
          issues.push({
            nodeId: node.id,
            severity: "error",
            message: `"${node.data.label}": form input cannot be used inside a regex/wildcard dispatcher, because the shared fallback command cannot track which trigger paused. Move it to a command- or keyword-triggered path.`,
          });
          currentId = null;
          break;
        }

        currentStage.pauseAt = node.data;
        stages.push(currentStage);
        currentStage = {
          statements: [],
          resumeFrom: node.data,
          pauseAt: null,
          isFinal: false,
        };

        currentId = nextNodeId(index, node.id);
        break;
      }
    }
  }

  currentStage.isFinal = true;
  stages.push(currentStage);

  return stages;
}

/** Emit a condition branch body — statements only, no state blocks. */
function emitBranch(
  startId: string | null,
  index: GraphIndex,
  context: EmitContext,
  issues: ValidationIssue[],
  used: Set<string>,
  options: { allowState: boolean; depth: number },
): string[] {
  if (!startId) return [];

  const stages = emitChain(startId, index, context, issues, used, {
    allowState: false,
    depth: options.depth + 1,
  });

  // A branch cannot pause, so only the first stage's statements are meaningful.
  const statements = stages.flatMap((stage) => stage.statements);

  if (stages.some((stage) => stage.pauseAt)) {
    issues.push({
      nodeId: startId,
      severity: "error",
      message:
        "Form input inside a condition branch is not supported: the branch would be re-evaluated on the next message and could take a different path. Move the input block onto the main flow.",
    });
  }

  return statements;
}

// ---------------------------------------------------------------------------
// Command assembly
// ---------------------------------------------------------------------------

/**
 * Build the `if (__step === n)` ladder for a chain that contains pauses.
 *
 * Stage N consumes the answer to the state block that ended stage N-1, so the
 * capture code is emitted at the top of the stage rather than after the prompt.
 *
 * `scope` picks the TeleBotHost collection holding the control record. The record
 * holds both the step counter and the captured answers, so it must live in one
 * place — mixing `db.user` and `db.bot` across blocks in the same chain would put
 * the counter and the values in different drawers.
 */
function buildStageMachine(
  stages: Stage[],
  stateKey: string,
  context: EmitContext,
  scope: "user" | "bot",
): string {
  const store = scope === "bot" ? "db.bot" : "db.user";

  const lines: string[] = [
    `let __wf = await ${store}.get(${js(stateKey)}, { step: 0, vars: {} })`,
    `if (!__wf || typeof __wf !== "object") __wf = { step: 0, vars: {} }`,
    `if (!__wf.vars || typeof __wf.vars !== "object") __wf.vars = {}`,
    ``,
    `switch (__wf.step) {`,
  ];

  stages.forEach((stage, stageIndex) => {
    lines.push(`  case ${stageIndex}: {`);

    const body: string[] = [];

    // -- consume the previous stage's answer -------------------------------
    if (stage.resumeFrom) {
      const state = stage.resumeFrom;
      const variable = state.variable.trim();
      const errorMessage =
        state.errorMessage.trim() || "That doesn't look right. Please try again.";

      body.push(`const __val = String(message || "").trim()`);
      body.push(`let __bad = false`);

      if (state.required) {
        body.push(`if (__val.length === 0) __bad = true`);
      }

      const validation = stateValidatorExpression(state.validator);
      if (validation) {
        body.push(`if (!__bad && __val.length > 0 && !(${validation})) __bad = true`);
      }

      body.push(`if (__bad) {`);
      body.push(`  Bot.sendMessage(${js(errorMessage)})`);
      body.push(`  Bot.sendMessage(${js(state.prompt)})`);
      body.push(`  return`);
      body.push(`}`);

      if (variable) {
        body.push(`__wf.vars.${variable} = __val`);
      }

      if (state.confirmMessage.trim()) {
        body.push(
          `Bot.sendMessage(${buildTemplateExpression(state.confirmMessage, context.table, stateKey)})`,
        );
      }
      body.push(``);
    }

    // -- the stage's own statements ----------------------------------------
    body.push(...stage.statements);

    // -- pause, or finish ---------------------------------------------------
    if (stage.pauseAt) {
      const state = stage.pauseAt;
      body.push(``);
      body.push(`__wf.step = ${stageIndex + 1}`);
      body.push(`await ${store}.set(${js(stateKey)}, __wf)`);
      body.push(
        `Bot.sendMessage(${buildTemplateExpression(state.prompt, context.table, stateKey)})`,
      );
      body.push(`return`);
    } else {
      body.push(``);
      body.push(`await ${store}.set(${js(stateKey)}, null)`);
      body.push(`return`);
    }

    lines.push(indent(body.join("\n"), 4));
    lines.push(`  }`);
  });

  lines.push(`  default:`);
  lines.push(`    await ${store}.set(${js(stateKey)}, null)`);
  lines.push(`    return`);
  lines.push(`}`);

  return lines.join("\n");
}

function stateValidatorExpression(validator: StateBlockData["validator"]): string | null {
  switch (validator) {
    case "email":
      return `/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(__val)`;
    case "phone":
      return `/^[+]?[\\d\\s()\\-]{6,20}$/.test(__val)`;
    case "number":
      return `__val.length > 0 && isFinite(Number(__val))`;
    case "url":
      return `/^https?:\\/\\/.+/i.test(__val)`;
    case "text":
      return `__val.length > 0`;
    case "none":
    default:
      return null;
  }
}

/** Build a full command body for one trigger's chain. */
function buildCommandCode(
  stages: Stage[],
  stateKey: string,
  localVariables: string[],
  context: EmitContext,
  scope: "user" | "bot",
): { code: string; needReply: boolean } {
  const hasPauses = stages.some((stage) => stage.pauseAt);

  const header: string[] = [];

  if (localVariables.length > 0) {
    header.push(`// Variables written by this workflow.`);
    for (const name of localVariables) header.push(`let ${name} = null`);
    header.push(``);
  }

  if (!hasPauses) {
    // No pauses — a straight-line script, which is the common case and produces the
    // cleanest possible TBL.
    const body = stages.flatMap((stage) => stage.statements).join("\n");
    return { code: [...header, body].join("\n"), needReply: false };
  }

  return {
    code: [...header, buildStageMachine(stages, stateKey, context, scope)].join("\n"),
    needReply: true,
  };
}

/**
 * Decide which `db` collection holds the control record for a chain, and warn when
 * the author mixed scopes (which cannot work — one record, one collection).
 */
function resolveRecordScope(
  stages: Stage[],
  issues: ValidationIssue[],
): "user" | "bot" {
  const scopes = new Set<"user" | "bot">();
  for (const stage of stages) {
    if (stage.pauseAt) scopes.add(stage.pauseAt.scope);
    if (stage.resumeFrom) scopes.add(stage.resumeFrom.scope);
  }

  if (scopes.size > 1) {
    issues.push({
      nodeId: "",
      severity: "warning",
      message:
        "This flow mixes per-user and shared form storage. The step counter and answers must live in one collection, so per-user storage was used for all of them.",
    });
    return "user";
  }

  return scopes.has("bot") ? "bot" : "user";
}

/**
 * Flag `{{references}}` to a local variable that were written *before* a pause.
 *
 * This is the subtlest failure mode in the whole compiler. An API or Message block
 * binds an ordinary `let`, which exists only for the duration of one command
 * execution. A form-input block pauses execution and resumes on the user's next
 * message — a brand-new execution, where that binding is back to `null`. The
 * generated code is still valid JavaScript, so nothing throws; the value just
 * silently comes out empty. Worth a warning.
 */
function findCrossStageLocalReferences(
  startId: string,
  index: GraphIndex,
  table: VariableTable,
  issues: ValidationIssue[],
): void {
  const visited = new Set<string>();

  function walk(fromId: string | null, pausedBefore: boolean): void {
    let id = fromId;
    let paused = pausedBefore;

    while (id && !visited.has(id)) {
      visited.add(id);

      const node = index.byId.get(id);
      if (!node) return;

      if (paused) {
        for (const reference of collectReferences(node.data)) {
          const root = reference.split(".")[0] ?? reference;
          if (table.get(root) !== "local") continue;

          issues.push({
            nodeId: node.id,
            severity: "warning",
            field: "text",
            message: `${node.data.label}: "{{${reference}}}" was set by an API or Message block before a form-input step. Those values do not survive the pause, so this will read null — capture it with a form-input block instead.`,
          });
        }
      }

      if (node.type === "state") paused = true;

      if (node.type === "condition") {
        walk(nextNodeId(index, id, HANDLE.TRUE), paused);
        walk(nextNodeId(index, id, HANDLE.FALSE), paused);
        return;
      }

      id = nextNodeId(index, id);
    }
  }

  walk(startId, false);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function compileCanvasToTeleBotHostScript(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  options: { documentId?: string } = {},
): WorkflowCompileResult {
  const index = indexGraph(nodes, edges);
  const issues = collectGraphIssues(nodes, edges, index);

  const commands: CompiledWorkflowCommand[] = [];
  const usedNodes = new Set<string>();
  const documentId = options.documentId ?? "doc";

  const triggers = nodes.filter((node) => node.type === "trigger");
  const regularTriggers = triggers.filter(
    (node) => !isDispatcherTrigger(node.data as TriggerBlockData),
  );
  const dispatcherTriggers = triggers.filter((node) =>
    isDispatcherTrigger(node.data as TriggerBlockData),
  );

  let stateBlocks = 0;
  for (const node of nodes) {
    if (node.type === "state") stateBlocks += 1;
  }

  // -- 1. One command per regular trigger ---------------------------------
  for (const trigger of regularTriggers) {
    const data = trigger.data as TriggerBlockData;
    const name = triggerName(data);
    if (!name) continue;

    const stateKey = `__wf_${documentId}_${name.replace(/[^A-Za-z0-9_]/g, "_")}`;

    // Pre-pass: work out which variables this command produces and how each is
    // stored, so `{{references}}` resolve to the right accessor.
    const table: VariableTable = new Map();
    const reachable = collectReachable(trigger.id, index);
    for (const nodeId of reachable) {
      const node = index.byId.get(nodeId);
      if (!node) continue;
      for (const variable of collectProducedVariables(node.data)) {
        if (RESERVED_NAMES.has(variable)) continue;
        table.set(variable, node.type === "state" ? "state" : "local");
      }
    }

    let counter = 0;
    const context: EmitContext = {
      table,
      stateKey,
      nextTemp: () => {
        counter += 1;
        return counter;
      },
    };

    const stages = emitChain(nextNodeId(index, trigger.id), index, context, issues, usedNodes, {
      allowState: true,
      depth: 0,
    });

    const localVariables = [...table.entries()]
      .filter(([, kind]) => kind === "local")
      .map(([variable]) => variable)
      .filter((variable) => !variable.includes("."));

    findCrossStageLocalReferences(trigger.id, index, table, issues);

    const scope = resolveRecordScope(stages, issues);
    const { code, needReply } = buildCommandCode(
      stages,
      stateKey,
      localVariables,
      context,
      scope,
    );

    commands.push({
      name,
      answer: "",
      code,
      parse_mode: "Markdown",
      keyboard: "",
      aliases: data.aliases.map((alias) => alias.trim()).filter(Boolean),
      need_reply: needReply,
      case_insensitive: data.caseInsensitive,
      allow_only_group: data.groupOnly,
      is_web: 0,
      folder: "",
      sourceNodeIds: [trigger.id],
    });
  }

  // -- 2. Single dispatcher for regex + wildcard --------------------------
  if (dispatcherTriggers.length > 0) {
    const lines: string[] = [
      `// Generated fallback dispatcher.`,
      `// TBL routes exact name -> alias -> dynamic handler -> '*', and the router has`,
      `// no regex support, so every pattern rule is tested here in order.`,
      ``,
      `const __TEXT = String(message || "").trim()`,
      ``,
    ];

    const regexTriggers = dispatcherTriggers.filter(
      (node) => (node.data as TriggerBlockData).triggerKind === "regex",
    );
    const wildcardTrigger = dispatcherTriggers.find(
      (node) => (node.data as TriggerBlockData).triggerKind === "wildcard",
    );

    for (const trigger of regexTriggers) {
      const data = trigger.data as TriggerBlockData;
      const pattern = data.value.trim();
      const flags = data.caseInsensitive ? "i" : "";

      const table: VariableTable = new Map();
      const reachable = collectReachable(trigger.id, index);
      for (const nodeId of reachable) {
        const node = index.byId.get(nodeId);
        if (!node) continue;
        for (const variable of collectProducedVariables(node.data)) {
          if (!RESERVED_NAMES.has(variable)) {
            table.set(variable, node.type === "state" ? "state" : "local");
          }
        }
      }

      let counter = 1000;
      const context: EmitContext = {
        table,
        stateKey: `__wf_${documentId}_regex`,
        nextTemp: () => {
          counter += 1;
          return counter;
        },
      };

      const stages = emitChain(nextNodeId(index, trigger.id), index, context, issues, usedNodes, {
        allowState: false,
        depth: 0,
      });
      const body = stages.flatMap((stage) => stage.statements);

      lines.push(`// Rule: ${data.label}`);
      lines.push(`if (/${pattern.replace(/\//g, "\\/")}/${flags}.test(__TEXT)) {`);
      lines.push(indent(body.join("\n") || "// no actions connected", 2));
      lines.push(`  return`);
      lines.push(`}`);
      lines.push(``);
    }

    if (wildcardTrigger) {
      const table: VariableTable = new Map();
      const reachable = collectReachable(wildcardTrigger.id, index);
      for (const nodeId of reachable) {
        const node = index.byId.get(nodeId);
        if (!node) continue;
        for (const variable of collectProducedVariables(node.data)) {
          if (!RESERVED_NAMES.has(variable)) {
            table.set(variable, node.type === "state" ? "state" : "local");
          }
        }
      }

      let counter = 2000;
      const context: EmitContext = {
        table,
        stateKey: `__wf_${documentId}_wildcard`,
        nextTemp: () => {
          counter += 1;
          return counter;
        },
      };

      const stages = emitChain(nextNodeId(index, wildcardTrigger.id), index, context, issues, usedNodes, {
        allowState: false,
        depth: 0,
      });
      const body = stages.flatMap((stage) => stage.statements);

      lines.push(`// Fallback: ${(wildcardTrigger.data as TriggerBlockData).label}`);
      lines.push(body.join("\n") || `// no actions connected`);
    } else {
      lines.push(`Bot.sendMessage("Sorry, I didn't understand that.")`);
    }

    commands.push({
      name: "*",
      answer: "",
      code: lines.join("\n"),
      parse_mode: "Markdown",
      keyboard: "",
      aliases: [],
      need_reply: false,
      case_insensitive: false,
      allow_only_group: false,
      is_web: 0,
      folder: "",
      sourceNodeIds: dispatcherTriggers.map((node) => node.id),
    });
  }

  // -- 3. Orphan accounting -----------------------------------------------
  const orphanCount = nodes.filter(
    (node) => node.type !== "trigger" && !usedNodes.has(node.id),
  ).length;

  return {
    commands,
    issues,
    hasErrors: issues.some((issue) => issue.severity === "error"),
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      triggerCount: triggers.length,
      commandCount: commands.length,
      stateBlocks,
      orphanCount,
    },
  };
}

/** Every node reachable downstream from a start node. */
function collectReachable(startId: string, index: GraphIndex): Set<string> {
  const seen = new Set<string>();
  const queue = [startId];

  while (queue.length > 0) {
    const id = queue.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    for (const edge of index.outgoing.get(id) ?? []) queue.push(edge.target);
  }

  return seen;
}

/** Convenience wrapper for the UI: just the generated scripts. */
export function compileWorkflowPreview(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  documentId?: string,
): WorkflowCompileResult {
  return compileCanvasToTeleBotHostScript(nodes, edges, { documentId });
}

export { BLOCK_BY_KIND };
