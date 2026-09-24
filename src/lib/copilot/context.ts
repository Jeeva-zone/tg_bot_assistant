/**
 * Bot context for the copilot.
 *
 * The model can only give context-aware help if it knows what already exists. But
 * a bot can hold up to 1,000 commands, and dumping every script into the prompt
 * would blow the context window and cost the user money on every turn.
 *
 * So this builder is a **budgeted summariser**: it caps the number of commands, caps
 * each code preview, and extracts the facts that actually change the model's answer —
 * which triggers are taken, which variables already exist, which env vars are
 * configured. Everything the model needs, nothing it does not.
 */

import type { BotEnvVar, BotListItem, TblCommand } from "@/types/telebothost";
import type { CopilotBotContext, CopilotCommandSummary } from "@/types/copilot";

const DEFAULT_MAX_COMMANDS = 40;
const DEFAULT_CODE_PREVIEW = 600;

/** `db.user.get("key"` / `db.bot.set("key"` — the storage keys a script uses. */
const DB_KEY_PATTERN = /db\.(?:user|bot|global)\.(?:get|set|del|has|incr|decr|push|pull)\(\s*["']([^"']+)["']/g;

/** `process.env.NAME` / `env.NAME` */
const ENV_PATTERN = /(?:process\.env|env)\.([A-Z][A-Z0-9_]*)/g;

/** `let foo =` / `const foo =` at the start of a line — top-level bindings. */
const BINDING_PATTERN = /^\s*(?:let|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/gm;

function collectMatches(pattern: RegExp, text: string): string[] {
  const found = new Set<string>();
  // Reset lastIndex because the regexes are module-level and stateful with /g.
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

/** Summarise one command for the prompt. */
function summariseCommand(command: TblCommand, maxCodePreview: number): CopilotCommandSummary {
  const code = command.code ?? "";
  const truncated = code.length > maxCodePreview;
  const codePreview = truncated ? `${code.slice(0, maxCodePreview)}` : code;

  return {
    name: command.name,
    aliases: Array.isArray(command.aliases) ? command.aliases : [],
    codePreview,
    codeLength: code.length,
    needReply: Boolean(command.need_reply),
    parseMode: command.parse_mode || "Markdown",
    truncated,
  };
}

export interface BuildContextInput {
  bot: BotListItem | null;
  commands: TblCommand[];
  envVars?: BotEnvVar[];
  hasWriteKey: boolean;
  activeSurface: CopilotBotContext["activeSurface"];
  /** Cap on how many commands reach the prompt. */
  maxCommands?: number;
  /** Cap on each command's code preview, in characters. */
  maxCodePreview?: number;
}

export function buildBotContext(input: BuildContextInput): CopilotBotContext {
  const {
    bot,
    commands,
    envVars = [],
    hasWriteKey,
    activeSurface,
    maxCommands = DEFAULT_MAX_COMMANDS,
    maxCodePreview = DEFAULT_CODE_PREVIEW,
  } = input;

  if (!bot) {
    return {
      botId: null,
      botName: "",
      botUsername: "",
      status: "unknown",
      commands: [],
      variables: [],
      envVarNames: envVars.map((item) => item.name),
      hasWriteKey,
      folders: [],
      activeSurface,
    };
  }

  // Show the most recently updated commands first — those are the ones the user is
  // most likely to be iterating on.
  const ordered = [...commands].sort((a, b) => {
    const left = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
    const right = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
    return right - left;
  });

  const selected = ordered.slice(0, maxCommands);

  // -- variables -----------------------------------------------------------
  // Anything a script writes is a name the model may want to reuse. We deliberately
  // never read values — only key names, which carry no secrets.
  const variables = new Set<string>();
  for (const command of commands) {
    const code = command.code ?? "";
    for (const key of collectMatches(DB_KEY_PATTERN, code)) variables.add(key);
    for (const binding of collectMatches(BINDING_PATTERN, code)) {
      // Skip short-lived temporaries the compiler generates.
      if (!binding.startsWith("__")) variables.add(binding);
    }
  }

  // -- env vars ------------------------------------------------------------
  const envVarNames = new Set<string>(envVars.map((item) => item.name));
  for (const command of commands) {
    for (const name of collectMatches(ENV_PATTERN, command.code ?? "")) envVarNames.add(name);
  }

  // -- folders -------------------------------------------------------------
  const folders = new Set<string>();
  for (const command of commands) {
    if (command.folder?.trim()) folders.add(command.folder.trim());
  }

  return {
    botId: bot.bot_id,
    botName: bot.name,
    botUsername: bot.bot_username,
    status: bot.status === 1 ? "online" : "offline",
    commands: selected.map((command) => summariseCommand(command, maxCodePreview)),
    variables: [...variables].slice(0, 40),
    envVarNames: [...envVarNames].slice(0, 30),
    hasWriteKey,
    folders: [...folders],
    activeSurface,
  };
}

/** True when the context had to drop commands to stay inside the budget. */
export function contextWasTrimmed(context: CopilotBotContext, totalCommands: number): boolean {
  return context.commands.length < totalCommands;
}
