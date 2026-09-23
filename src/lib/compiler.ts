/**
 * The compiler: lowers the visual builder state into TeleBotHost (TBL) commands.
 *
 * This is the heart of the app. Everything the user configures in the UI has to
 * survive the trip down to `{ name, answer, code, keyboard, aliases, ... }`, and
 * the rules are unforgiving:
 *
 *  1. TBL routing is **exact name → alias → dynamic handler → `*` fallback**.
 *     There is no regex matching in the router. So regex triggers cannot become
 *     command names; they must be consolidated into a single `*` dispatcher
 *     command whose JavaScript tests each pattern. This compiler does that.
 *  2. Only **one** `*` command is allowed per bot, so every regex rule and the
 *     wildcard node have to share it.
 *  3. With `need_reply`, the Answer field is re-sent every time the command
 *     re-runs. For multi-step flows that would spam the user, so flow commands
 *     must deliver everything from `code` and leave `answer` empty.
 *  4. A reply keyboard cannot be sent without a message, so a keyboard-only
 *     command still needs text.
 */

import type {
  CommandNode,
  FlowStep,
  InlineButton,
  ReplyKeyboardConfig,
  TriggerConfig,
} from "@/types/builder";
import { TBH_CAPACITY } from "@/types/telebothost";
import type { CreateCommandRequest } from "@/types/telebothost";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface CompiledCommand extends CreateCommandRequest {
  /** Which builder node produced this command — used for deploy-time mapping. */
  sourceNodeIds: string[];
  /** Set when this command is the shared `*` dispatcher. */
  isDispatcher?: boolean;
}

export type DiagnosticLevel = "error" | "warning";

export interface Diagnostic {
  level: DiagnosticLevel;
  /** Builder node the problem belongs to, when it is node-specific. */
  nodeId?: string;
  nodeLabel?: string;
  message: string;
}

export interface CompileResult {
  commands: CompiledCommand[];
  diagnostics: Diagnostic[];
  /** True when at least one `error`-level diagnostic exists — deploy is blocked. */
  hasErrors: boolean;
  stats: {
    nodeCount: number;
    commandCount: number;
    regexRules: number;
    skipped: number;
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Emit a JavaScript string literal safely, including newlines and quotes. */
function js(value: string): string {
  return JSON.stringify(value);
}

/** Emit a JS regex literal, escaping `/` so it cannot terminate the literal. */
function regexLiteral(pattern: string, flags: string): string {
  return `/${pattern.replace(/\//g, "\\/")}/${flags}`;
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.trim().length === 0 ? line : pad + line))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Trigger lowering
// ---------------------------------------------------------------------------

/**
 * The `name` a command is registered under.
 *
 * `command` and `keyword` map straight through, `callback` uses the raw
 * callback_data token, and `wildcard` becomes `*`. Regex is handled by the
 * dispatcher, never as a name.
 */
export function triggerToName(trigger: TriggerConfig): string {
  switch (trigger.kind) {
    case "wildcard":
      return "*";
    case "command": {
      const raw = trigger.value.trim();
      if (raw.startsWith("/")) return raw;
      return raw.length > 0 ? `/${raw}` : "";
    }
    case "keyword":
    case "callback":
    case "regex":
      return trigger.value.trim();
    default:
      return "";
  }
}

/** Validate a trigger and return human-readable problems. */
function validateTrigger(trigger: TriggerConfig): string[] {
  const problems: string[] = [];
  const value = trigger.value.trim();

  switch (trigger.kind) {
    case "command":
      if (!value) {
        problems.push("Command trigger is empty. Example: /start");
      } else if (!/^\/[A-Za-z0-9_]+$/.test(value.startsWith("/") ? value : `/${value}`)) {
        problems.push(
          `"${value}" is not a valid Telegram command. Use letters, digits and underscores, e.g. /start.`,
        );
      }
      break;

    case "keyword":
      if (!value) problems.push("Keyword trigger is empty. Example: Help");
      break;

    case "regex":
      if (!value) {
        problems.push("Regex trigger is empty. Example: ^order\\s+(\\d+)$");
      } else {
        try {
          new RegExp(value);
        } catch (error) {
          problems.push(
            `Regex is invalid: ${error instanceof Error ? error.message : "parse error"}`,
          );
        }
      }
      break;

    case "wildcard":
      // Always valid — there is exactly one fallback per bot.
      break;

    case "callback":
      if (!value) problems.push("Callback trigger is empty. Example: confirm");
      break;
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Keyboards
// ---------------------------------------------------------------------------

/**
 * Lower the reply-keyboard grid into TBL's string format.
 *
 * Documented layout: commas separate buttons in a row, newlines start a new row —
 * so `[[A, B], [C]]` becomes `"A, B\nC"`.
 */
export function keyboardToTblString(config: ReplyKeyboardConfig): string {
  if (!config.enabled) return "";

  return config.rows
    .map((row) =>
      row
        .map((label) => label.trim())
        .filter((label) => label.length > 0)
        .join(", "),
    )
    .filter((row) => row.length > 0)
    .join("\n");
}

/** Build the raw Telegram `reply_markup` payload for a command, or `null`. */
function buildReplyMarkup(node: CommandNode): Record<string, unknown> | null {
  const inline = node.response.inlineKeyboard;
  if (inline.enabled) {
    const rows = inline.rows
      .map((row) =>
        row
          .filter((button) => button.text.trim().length > 0)
          .map((button: InlineButton) => {
            if (button.action === "url") {
              return { text: button.text.trim(), url: button.value.trim() };
            }
            return { text: button.text.trim(), callback_data: button.value.trim() };
          }),
      )
      .filter((row) => row.length > 0);

    if (rows.length > 0) return { inline_keyboard: rows };
  }

  const keyboard = node.keyboard;
  if (keyboard.enabled) {
    const rows = keyboard.rows
      .map((row) =>
        row
          .map((label) => label.trim())
          .filter((label) => label.length > 0)
          .map((label) => ({ text: label })),
      )
      .filter((row) => row.length > 0);

    if (rows.length > 0) {
      const markup: Record<string, unknown> = {
        keyboard: rows,
        resize_keyboard: keyboard.resize,
      };
      if (keyboard.oneTime) markup.one_time_keyboard = true;
      if (keyboard.placeholder.trim()) {
        markup.input_field_placeholder = keyboard.placeholder.trim();
      }
      return markup;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Flow (multi-step form) code generation
// ---------------------------------------------------------------------------

/**
 * Emit the JavaScript predicate that validates one step's input.
 *
 * The variable must be `__val` — that is what the generated state machine
 * declares. (Using a bare `val` here would parse fine but throw at runtime.)
 */
function buildValidatorExpression(step: FlowStep): string {
  switch (step.validator) {
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
      return `true`;
  }
}

/**
 * Generate the state machine that drives a multi-step form.
 *
 * The flow lives in `db.user` (or `db.bot`) under a per-command key, holding
 * `{ step, data }`. `step` is the index of the *next* question to ask, which
 * makes the "is the incoming message an answer?" test simply `step > 0`.
 *
 * The command must have `need_reply: true` for this to work: TBL pauses after
 * the Answer and re-runs the Logic with the user's next message.
 */
function buildFlowCode(node: CommandNode): string {
  const { steps, scope, completionMessage } = node.flow;
  const stateKey = `flow_${node.id}`;

  const keys = steps.map((step) => step.key.trim() || "field");
  const prompts = steps.map((step) => step.prompt.trim() || `Please send ${step.key.trim()}.`);
  const validators = steps.map(buildValidatorExpression);
  const required = steps.map((step) => step.required);
  const errorMessages = steps.map(
    (step) => step.errorMessage.trim() || "That doesn't look right. Please try again.",
  );

  const store = `db.${scope === "bot" ? "bot" : "user"}`;

  return [
    `// --- Multi-step form: ${node.label} ---`,
    // JSON.stringify already yields a valid JS array literal — wrapping it again
    // in js() would produce a *string*, and __KEYS[__i] would then index
    // characters instead of the keys.
    `const __KEYS = ${JSON.stringify(keys)}`,
    `const __PROMPTS = ${JSON.stringify(prompts)}`,
    `const __REQUIRED = ${JSON.stringify(required)}`,
    `const __ERRORS = ${JSON.stringify(errorMessages)}`,
    `const __STATE_KEY = ${js(stateKey)}`,
    ``,
    `let __st = await ${store}.get(__STATE_KEY, { step: 0, data: {} })`,
    `if (!__st || typeof __st.step !== "number") __st = { step: 0, data: {} }`,
    `if (!__st.data || typeof __st.data !== "object") __st.data = {}`,
    ``,
    `// Any message arriving while step > 0 is the answer to the previous question.`,
    `if (__st.step > 0) {`,
    `  const __i = __st.step - 1`,
    `  const __val = String(message || "").trim()`,
    `  let __bad = false`,
    `  if (__REQUIRED[__i] && __val.length === 0) __bad = true`,
    // An optional field left blank skips format validation entirely.
    `  if (!__bad && __val.length > 0) {`,
    ...validators.map(
      (expr, index) =>
        `    ${index === 0 ? "if" : "else if"} (__i === ${index} && !(${expr})) __bad = true`,
    ),
    `  }`,
    `  if (__bad) {`,
    `    Bot.sendMessage(__ERRORS[__i])`,
    `    Bot.sendMessage(__PROMPTS[__i])`,
    `    return`,
    `  }`,
    `  __st.data[__KEYS[__i]] = __val`,
    `}`,
    ``,
    `// Every question answered — hand back the collected data and reset.`,
    `if (__st.step >= __KEYS.length) {`,
    `  await ${store}.set(__STATE_KEY, null)`,
    `  Bot.sendMessage(${js(completionMessage)})`,
    `  Bot.sendMessage("Collected: " + JSON.stringify(__st.data))`,
    `  return`,
    `}`,
    ``,
    `// Ask the next question.`,
    `const __prompt = __PROMPTS[__st.step]`,
    `__st.step = __st.step + 1`,
    `await ${store}.set(__STATE_KEY, __st)`,
    `Bot.sendMessage(__prompt)`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Response delivery code generation
// ---------------------------------------------------------------------------

/**
 * True when the response cannot be expressed with the `answer` field alone and
 * therefore has to be sent from JavaScript.
 *
 * The reply keyboard is included only when it uses non-default options: TBL's
 * `keyboard` string field cannot carry `resize_keyboard`, `one_time_keyboard` or
 * an input placeholder, so we fall back to sending raw `reply_markup` when the
 * author actually customised those. Simple keyboards stay idiomatic.
 */
function needsCodeDelivery(node: CommandNode): boolean {
  const keyboardNeedsMarkup =
    node.keyboard.enabled &&
    (node.keyboard.oneTime ||
      !node.keyboard.resize ||
      node.keyboard.placeholder.trim().length > 0);

  return (
    node.response.media.length > 0 ||
    (node.response.inlineKeyboard.enabled && node.response.inlineKeyboard.rows.length > 0) ||
    (node.flow.enabled && node.flow.steps.length > 0) ||
    node.trigger.kind === "callback" ||
    keyboardNeedsMarkup
  );
}

/** Media sends, in the order the user arranged them. */
function buildMediaCode(node: CommandNode): string[] {
  const lines: string[] = [];

  for (const item of node.response.media) {
    const source = (item.fileId?.trim() || item.source.trim());
    if (!source) continue;

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

    const payload: Record<string, unknown> = { [field]: source };
    if (item.caption.trim()) {
      payload.caption = item.caption.trim();
      payload.parse_mode = node.response.parseMode;
    }

    lines.push(`await Api.${method}(${JSON.stringify(payload)})`);
  }

  return lines;
}

/** The text message, carrying any reply_markup. */
function buildTextCode(node: CommandNode, textOverride?: string): string[] {
  const text = (textOverride ?? node.response.text).trim();
  const markup = buildReplyMarkup(node);

  if (!text && !markup) return [];
  if (!text && markup) {
    // Telegram cannot send buttons with no message body.
    return [
      `await Api.sendMessage(${JSON.stringify({
        text: "Choose an option:",
        parse_mode: node.response.parseMode,
        reply_markup: markup,
      })})`,
    ];
  }

  const payload: Record<string, unknown> = {
    text,
    parse_mode: node.response.parseMode,
  };
  if (markup) payload.reply_markup = markup;

  return [`await Api.sendMessage(${JSON.stringify(payload)})`];
}

/**
 * Full delivery block for a node: dismiss any callback spinner, send media,
 * then send the text (or run the flow state machine).
 */
function buildDeliveryCode(node: CommandNode): string {
  const lines: string[] = [];

  if (node.trigger.kind === "callback") {
    lines.push(`Api.answerCallbackQuery()`);
  }

  if (node.flow.enabled && node.flow.steps.length > 0) {
    // The flow owns the conversation; media goes out first as an optional intro.
    lines.push(...buildMediaCode(node));
    lines.push(buildFlowCode(node));
    return lines.join("\n");
  }

  lines.push(...buildMediaCode(node));
  lines.push(...buildTextCode(node));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Per-node compilation
// ---------------------------------------------------------------------------

function compileNode(node: CommandNode): CompiledCommand | null {
  const name = triggerToName(node.trigger);
  const deliverFromCode = needsCodeDelivery(node);

  const aliases = node.aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0);

  const answer = deliverFromCode ? "" : node.response.text.trim();

  // The reply keyboard rides on the `answer` field for simple commands, and
  // inside reply_markup when we are already sending from code.
  const keyboard = deliverFromCode ? "" : keyboardToTblString(node.keyboard);

  const flowActive = node.flow.enabled && node.flow.steps.length > 0;
  const needReply = flowActive ? true : node.needReply;

  return {
    name,
    answer,
    code: deliverFromCode ? buildDeliveryCode(node) : "",
    parse_mode: node.response.parseMode,
    keyboard,
    aliases,
    need_reply: needReply,
    case_insensitive: node.trigger.caseInsensitive,
    allow_only_group: node.groupOnly,
    is_web: 0,
    folder: node.folder.trim(),
    sourceNodeIds: [node.id],
  };
}

// ---------------------------------------------------------------------------
// Wildcard / regex dispatcher
// ---------------------------------------------------------------------------

/**
 * Build the single `*` command that handles every regex rule plus the wildcard
 * node. TBL permits only one fallback command per bot, so all of them have to
 * live together here.
 */
function compileDispatcher(
  regexNodes: CommandNode[],
  wildcardNode: CommandNode | null,
): CompiledCommand {
  const lines: string[] = [
    `// Generated fallback dispatcher.`,
    `// TBL routes exact name -> alias -> dynamic handler -> '*', and the router has`,
    `// no regex support, so every pattern rule is tested here in order.`,
    ``,
    `const __TEXT = String(message || "").trim()`,
    ``,
  ];

  for (const node of regexNodes) {
    const pattern = node.trigger.value.trim();
    const flags = node.trigger.caseInsensitive ? "i" : "";

    lines.push(`// Rule: ${node.label}`);
    lines.push(`if (${regexLiteral(pattern, flags)}.test(__TEXT)) {`);
    lines.push(indent(buildDeliveryCode(node), 2));
    lines.push(`  return`);
    lines.push(`}`);
    lines.push(``);
  }

  if (wildcardNode) {
    lines.push(`// Fallback: ${wildcardNode.label}`);
    lines.push(indent(buildDeliveryCode(wildcardNode), 0));
  } else {
    lines.push(`// No wildcard command configured — reply with a default hint.`);
    lines.push(
      `Bot.sendMessage("Sorry, I didn't understand that. Send /start to see what I can do.")`,
    );
  }

  return {
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
    sourceNodeIds: [
      ...regexNodes.map((node) => node.id),
      ...(wildcardNode ? [wildcardNode.id] : []),
    ],
    isDispatcher: true,
  };
}

// ---------------------------------------------------------------------------
// Project compilation
// ---------------------------------------------------------------------------

export function compileProject(project: import("@/types/builder").BotProject): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const commands: CompiledCommand[] = [];

  const enabled = project.commands.filter((node) => node.enabled);
  const skipped = project.commands.length - enabled.length;

  const regexNodes: CommandNode[] = [];
  const wildcardNodes: CommandNode[] = [];
  const regularNodes: CommandNode[] = [];

  for (const node of enabled) {
    const problems = validateTrigger(node.trigger);
    for (const message of problems) {
      diagnostics.push({
        level: "error",
        nodeId: node.id,
        nodeLabel: node.label,
        message,
      });
    }
    if (problems.length > 0) continue;

    if (node.trigger.kind === "regex") {
      regexNodes.push(node);
    } else if (node.trigger.kind === "wildcard") {
      wildcardNodes.push(node);
    } else {
      regularNodes.push(node);
    }
  }

  if (wildcardNodes.length > 1) {
    diagnostics.push({
      level: "warning",
      nodeId: wildcardNodes[1]?.id,
      nodeLabel: wildcardNodes[1]?.label,
      message:
        "Only one wildcard (*) command is allowed per bot. Extra wildcards were ignored — merge them into a single fallback.",
    });
  }

  // -- duplicate trigger detection -----------------------------------------
  const nameOwners = new Map<string, CommandNode[]>();
  for (const node of regularNodes) {
    const key = node.trigger.caseInsensitive
      ? triggerToName(node.trigger).toLowerCase()
      : triggerToName(node.trigger);
    const existing = nameOwners.get(key) ?? [];
    existing.push(node);
    nameOwners.set(key, existing);
  }

  for (const [name, owners] of nameOwners) {
    if (owners.length > 1) {
      diagnostics.push({
        level: "error",
        nodeId: owners[1]?.id,
        nodeLabel: owners[1]?.label,
        message: `Trigger "${name}" is used by ${owners.length} commands. TBL matches exactly one command per message — rename or remove the duplicate.`,
      });
    }
  }

  // -- per-node validation and compilation ----------------------------------
  for (const node of [...regularNodes, ...regexNodes, ...wildcardNodes.slice(0, 1)]) {
    const flowActive = node.flow.enabled && node.flow.steps.length > 0;

    if (node.keyboard.enabled && !node.response.text.trim() && !flowActive) {
      diagnostics.push({
        level: "error",
        nodeId: node.id,
        nodeLabel: node.label,
        message:
          "A reply keyboard needs a message to attach to. Add response text, or remove the keyboard.",
      });
    }

    if (node.keyboard.enabled && !flowActive) {
      const labels = node.keyboard.rows.flat().map((label) => label.trim()).filter(Boolean);
      const known = new Set(
        [triggerToName(node.trigger), ...node.aliases].map((value) =>
          node.trigger.caseInsensitive ? value.toLowerCase() : value,
        ),
      );
      const unmatched = labels.filter((label) =>
        node.trigger.caseInsensitive ? !known.has(label.toLowerCase()) : !known.has(label),
      );
      if (unmatched.length > 0) {
        diagnostics.push({
          level: "warning",
          nodeId: node.id,
          nodeLabel: node.label,
          message: `Keyboard button(s) ${unmatched
            .map((label) => `"${label}"`)
            .join(", ")} have no matching command or alias, so tapping them will hit the wildcard fallback. Add them as aliases to wire them up.`,
        });
      }
    }

    if (node.response.inlineKeyboard.enabled && node.keyboard.enabled) {
      diagnostics.push({
        level: "warning",
        nodeId: node.id,
        nodeLabel: node.label,
        message:
          "Both an inline keyboard and a reply keyboard are enabled. Telegram allows only one reply_markup per message, so the inline keyboard wins and the reply keyboard is dropped. Disable one of them.",
      });
    }

    if (flowActive) {
      const stepKeys = node.flow.steps.map((step) => step.key.trim());
      const emptyKeys = stepKeys.filter((key) => key.length === 0).length;
      if (emptyKeys > 0) {
        diagnostics.push({
          level: "error",
          nodeId: node.id,
          nodeLabel: node.label,
          message: `${emptyKeys} flow step(s) are missing a storage key. Every step needs a unique key.`,
        });
      }
      const duplicates = stepKeys.filter(
        (key, index) => key.length > 0 && stepKeys.indexOf(key) !== index,
      );
      if (duplicates.length > 0) {
        diagnostics.push({
          level: "error",
          nodeId: node.id,
          nodeLabel: node.label,
          message: `Duplicate flow step key(s): ${[...new Set(duplicates)].join(", ")}. Keys must be unique or answers will overwrite each other.`,
        });
      }
      if (!node.needReply) {
        diagnostics.push({
          level: "warning",
          nodeId: node.id,
          nodeLabel: node.label,
          message:
            "This command has a multi-step form, so Need Reply was enabled automatically — TBL cannot pause for answers without it.",
        });
      }
      diagnostics.push({
        level: "warning",
        nodeId: node.id,
        nodeLabel: node.label,
        message:
          "Multi-step forms keep the need_reply session open after completion, so the next plain message restarts the form. Tell users to send /start to exit, or add a dedicated cancel command.",
      });
    }

    if (node.response.media.length > 0) {
      for (const item of node.response.media) {
        if (!item.source.trim() && !item.fileId?.trim()) {
          diagnostics.push({
            level: "error",
            nodeId: node.id,
            nodeLabel: node.label,
            message: `A ${item.kind} attachment has no URL or file_id.`,
          });
        }
      }
    }

    // Regex and wildcard nodes are emitted through the shared dispatcher, never as
    // standalone commands: their trigger is not a valid TeleBotHost command name
    // (a raw regex pattern as a command name would just be a dead entry).
    if (node.trigger.kind === "regex" || node.trigger.kind === "wildcard") continue;

    const compiled = compileNode(node);
    if (!compiled) continue;

    // Size guards from the documented TeleBotHost capacity limits.
    if (compiled.answer && compiled.answer.length > TBH_CAPACITY.maxAnswerChars) {
      diagnostics.push({
        level: "error",
        nodeId: node.id,
        nodeLabel: node.label,
        message: `Response text is ${compiled.answer.length.toLocaleString()} characters, over TeleBotHost's ${TBH_CAPACITY.maxAnswerChars.toLocaleString()} limit for a single answer.`,
      });
    }
    if (compiled.code && compiled.code.length > TBH_CAPACITY.maxCommandCodeChars) {
      diagnostics.push({
        level: "error",
        nodeId: node.id,
        nodeLabel: node.label,
        message: `Generated logic is ${compiled.code.length.toLocaleString()} characters, over TeleBotHost's ${TBH_CAPACITY.maxCommandCodeChars.toLocaleString()} limit.`,
      });
    }

    commands.push(compiled);
  }

  if (regexNodes.length > 0 || wildcardNodes.length > 0) {
    commands.push(compileDispatcher(regexNodes, wildcardNodes[0] ?? null));
    if (regexNodes.length > 0) {
      diagnostics.push({
        level: "warning",
        nodeId: regexNodes[0]?.id,
        nodeLabel: regexNodes[0]?.label,
        message: `${regexNodes.length} regex rule(s) were merged into the single "*" dispatcher command, because TBL's router matches exact names only. They still run in the order shown, first match wins.`,
      });
    }
  }

  if (commands.length > TBH_CAPACITY.maxCommandsPerBot) {
    diagnostics.push({
      level: "error",
      message: `This bot compiles to ${commands.length} commands, over TeleBotHost's ${TBH_CAPACITY.maxCommandsPerBot} per-bot cap.`,
    });
  }

  return {
    commands,
    diagnostics,
    hasErrors: diagnostics.some((item) => item.level === "error"),
    stats: {
      nodeCount: project.commands.length,
      commandCount: commands.length,
      regexRules: regexNodes.length,
      skipped,
    },
  };
}

/** Convenience wrapper for previewing a single command's generated TBL logic. */
export function previewCommandCode(node: CommandNode): string {
  if (node.trigger.kind === "regex" || node.trigger.kind === "wildcard") {
    return (
      compileDispatcher(
        node.trigger.kind === "regex" ? [node] : [],
        node.trigger.kind === "wildcard" ? node : null,
      ).code ?? ""
    );
  }
  const compiled = compileNode(node);
  return compiled?.code ?? "";
}
