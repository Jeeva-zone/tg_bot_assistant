/**
 * The visual builder's own state model.
 *
 * This is deliberately decoupled from the TeleBotHost wire format: the UI edits
 * these structures, and `lib/compiler.ts` lowers them into TBL commands. Keeping
 * the two apart means we can change the editing experience without touching the
 * deployment layer.
 */

import type { TblParseMode } from "./telegram";

export type { TblParseMode };

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

/**
 * How a message gets routed to this command.
 *
 * - `command`  — a slash command such as `/start`
 * - `keyword`  — exact text match, e.g. `Help`
 * - `regex`    — a regular expression, matched against the raw message text
 * - `wildcard` — the `*` fallback that catches everything else
 * - `callback` — inline button presses, routed via `/handle_callback_query`
 */
export type TriggerKind = "command" | "keyword" | "regex" | "wildcard" | "callback";

export interface TriggerConfig {
  kind: TriggerKind;
  /**
   * The literal trigger value. For `command` we store it with the leading slash
   * (`/start`); for `wildcard` this is always `*`; for `regex` it is the pattern
   * source without delimiters.
   */
  value: string;
  caseInsensitive: boolean;
}

export const TRIGGER_KIND_META: Record<
  TriggerKind,
  { label: string; description: string; placeholder: string }
> = {
  command: {
    label: "Slash command",
    description: "Matches /name and /name@YourBot. Longest name wins.",
    placeholder: "/start",
  },
  keyword: {
    label: "Keyword",
    description: "Exact text match. Case-sensitive unless you enable ignore case.",
    placeholder: "Help",
  },
  regex: {
    label: "Regex",
    description: "Matched in the generated TBL logic against the raw message text.",
    placeholder: "^order\\s+(\\d+)$",
  },
  wildcard: {
    label: "Wildcard fallback",
    description: "The `*` command — runs when nothing else matches. Only one allowed.",
    placeholder: "*",
  },
  callback: {
    label: "Inline button callback",
    description: "Handles callback_data from inline keyboard buttons.",
    placeholder: "confirm",
  },
};

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export type MediaKind = "photo" | "document" | "video" | "audio";

export interface MediaAttachment {
  id: string;
  kind: MediaKind;
  /** Public URL, or a Telegram file_id already uploaded by the user. */
  source: string;
  /** Telegram file_id, when the asset was uploaded rather than linked. */
  fileId?: string;
  caption: string;
}

export interface InlineButton {
  id: string;
  text: string;
  /** `callback` re-enters the bot's command router; `url` opens a link. */
  action: "callback" | "url";
  value: string;
}

export interface InlineKeyboardConfig {
  enabled: boolean;
  /** Rows of buttons, so the author controls the wrapping. */
  rows: InlineButton[][];
}

/**
 * The persistent reply keyboard. TeleBotHost serialises this into a plain string
 * (`"A, B\nC"`), where commas separate buttons in a row and newlines start a new
 * row — so we model it as a grid and lower it at compile time.
 */
export interface ReplyKeyboardConfig {
  enabled: boolean;
  rows: string[][];
  resize: boolean;
  oneTime: boolean;
  placeholder: string;
}

export interface ResponseConfig {
  /** The `answer` field — sent before logic runs. */
  text: string;
  parseMode: TblParseMode;
  media: MediaAttachment[];
  inlineKeyboard: InlineKeyboardConfig;
}

// ---------------------------------------------------------------------------
// Multi-step forms
// ---------------------------------------------------------------------------

export type FieldValidator = "none" | "email" | "phone" | "number" | "text" | "url";

export interface FlowStep {
  id: string;
  /** Storage key inside the `db.user` scope. */
  key: string;
  /** Prompt shown to the user when this step begins. */
  prompt: string;
  validator: FieldValidator;
  required: boolean;
  /** Custom failure message when validation rejects the input. */
  errorMessage: string;
}

export interface FlowConfig {
  enabled: boolean;
  steps: FlowStep[];
  /** Sent once every step has been collected. */
  completionMessage: string;
  /** Store collected answers in `db.user` (per-user) or `db.bot` (shared). */
  scope: "user" | "bot";
}

export const FIELD_VALIDATOR_META: Record<
  FieldValidator,
  { label: string; description: string }
> = {
  none: { label: "Anything", description: "Accept the raw text as-is." },
  text: { label: "Non-empty text", description: "Reject empty or whitespace-only input." },
  email: { label: "Email address", description: "Must look like name@example.com." },
  phone: { label: "Phone number", description: "Digits, spaces, +, -, and parentheses." },
  number: { label: "Number", description: "Must parse as a finite number." },
  url: { label: "URL", description: "Must start with http:// or https://." },
};

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface CommandNode {
  id: string;
  /** Human label used in the builder sidebar. */
  label: string;
  trigger: TriggerConfig;
  response: ResponseConfig;
  keyboard: ReplyKeyboardConfig;
  aliases: string[];
  needReply: boolean;
  groupOnly: boolean;
  flow: FlowConfig;
  /** TeleBotHost command folder name; empty string means "ungrouped". */
  folder: string;
  /** Author toggle — disabled commands are skipped during compilation. */
  enabled: boolean;
}

export interface BotProject {
  id: string;
  name: string;
  description: string;
  commands: CommandNode[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

export type DeploymentState =
  | "idle"
  | "validating"
  | "creating"
  | "compiling"
  | "uploading"
  | "starting"
  | "done"
  | "error";

export interface DeploymentLogLine {
  at: string;
  level: "info" | "success" | "warn" | "error";
  message: string;
}

export interface DeploymentRecord {
  id: string;
  botId: number;
  botName: string;
  botUsername: string;
  status: "online" | "offline" | "error";
  commandCount: number;
  deployedAt: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export interface TelegramCredentials {
  botToken: string;
  botUsername: string;
  botName: string;
  botId: number;
  validatedAt: string;
}

export interface TbhCredentials {
  apiKey: string;
  /** `sk_*` keys can write; `pub_*` keys are read-only. */
  keyType: "secret" | "public" | "unknown";
  validatedAt: string;
}

/**
 * The copilot's model configuration.
 *
 * The API key is a real secret, so it lives in the same encrypted vault as the
 * Telegram and TeleBotHost credentials rather than in plain localStorage.
 */
export interface LlmCredentials {
  provider: "openai" | "anthropic" | "custom";
  apiKey: string;
  model: string;
  /** Only used for OpenAI-compatible providers. */
  baseUrl?: string;
  /** Set once the key has been proven to work. */
  validatedAt?: string;
}

export interface CredentialBundle {
  telegram: TelegramCredentials;
  telebothost: TbhCredentials;
  /** Optional — the app works without a model, but the copilot needs one. */
  llm?: LlmCredentials;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export function createId(prefix = "id"): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}`;
}

export function createEmptyTrigger(): TriggerConfig {
  return { kind: "command", value: "/start", caseInsensitive: false };
}

export function createEmptyResponse(): ResponseConfig {
  return {
    text: "",
    parseMode: "Markdown",
    media: [],
    inlineKeyboard: { enabled: false, rows: [] },
  };
}

export function createEmptyKeyboard(): ReplyKeyboardConfig {
  return {
    enabled: false,
    rows: [[""]],
    resize: true,
    oneTime: false,
    placeholder: "",
  };
}

export function createEmptyFlow(): FlowConfig {
  return {
    enabled: false,
    steps: [],
    completionMessage: "Thanks! Your details have been saved.",
    scope: "user",
  };
}

export function createCommandNode(overrides: Partial<CommandNode> = {}): CommandNode {
  return {
    id: createId("cmd"),
    label: "New command",
    trigger: createEmptyTrigger(),
    response: createEmptyResponse(),
    keyboard: createEmptyKeyboard(),
    aliases: [],
    needReply: false,
    groupOnly: false,
    flow: createEmptyFlow(),
    folder: "",
    enabled: true,
    ...overrides,
  };
}

export function createFlowStep(index: number): FlowStep {
  return {
    id: createId("step"),
    key: `field_${index + 1}`,
    prompt: "",
    validator: "none",
    required: true,
    errorMessage: "",
  };
}

export function createProject(name = "Untitled Bot"): BotProject {
  const now = new Date().toISOString();
  return {
    id: createId("proj"),
    name,
    description: "",
    commands: [
      createCommandNode({
        label: "Start",
        trigger: { kind: "command", value: "/start", caseInsensitive: false },
        response: {
          text: "Welcome! I'm your new bot.",
          parseMode: "Markdown",
          media: [],
          inlineKeyboard: { enabled: false, rows: [] },
        },
      }),
    ],
    createdAt: now,
    updatedAt: now,
  };
}
