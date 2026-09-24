/**
 * Types for the AI Bot Engineer copilot.
 *
 * The copilot's contract with the model is a single JSON object. Everything the UI
 * renders — the explanation, the code preview, the diff, the deploy button — is
 * derived from that one structure, so the shape is defined once here and enforced by
 * the parser in `lib/copilot/schema.ts`.
 */

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type CopilotRole = "user" | "assistant";

export interface CopilotMessage {
  id: string;
  role: CopilotRole;
  /** Raw text. For assistant turns that produced a command, this is the explanation. */
  content: string;
  createdAt: string;
  /** Present when the assistant produced deployable code. */
  artifact?: CopilotArtifact;
  /** The model replied, but its JSON could not be parsed. */
  parseError?: string;
  /** The request failed before/while reaching the model. */
  error?: string;
  /** True while the turn is still in flight. */
  pending?: boolean;
  /** Model + provider that produced this turn, for transparency. */
  model?: string;
}

// ---------------------------------------------------------------------------
// Structured model output
// ---------------------------------------------------------------------------

/**
 * What the model is required to return.
 *
 * Only `explanation`, `command_name` and `tbl_code` are mandatory; the rest are
 * optional refinements the model may include when they apply.
 */
export interface CopilotArtifact {
  explanation: string;
  /** The trigger: `/start`, `Help`, `price_check`, or `*` for the fallback. */
  command_name: string;
  /** Executable TBL (JavaScript) for the command's Logic field. */
  tbl_code: string;
  /** Optional `answer` field — text sent before the logic runs. */
  answer?: string;
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  need_reply?: boolean;
  aliases?: string[];
  /** Optional keyboard, in whichever shape the model chose. Normalised for display. */
  keyboard?: unknown;
  /** Extra notes: caveats, required env vars, follow-up suggestions. */
  notes?: string[];
}

/** A keyboard reduced to something renderable and deployable. */
export interface NormalisedKeyboard {
  kind: "inline" | "reply";
  /** Rows of button labels, for the preview. */
  rows: string[][];
  /**
   * The value for TeleBotHost's `keyboard` field. Only reply keyboards can be
   * expressed there — inline keyboards must be built inside the code.
   */
  tblKeyboard: string;
  /** Set when the model returned something we had to interpret or drop. */
  warning?: string;
}

// ---------------------------------------------------------------------------
// Bot context
// ---------------------------------------------------------------------------

/** A compact view of one existing command, used as model context. */
export interface CopilotCommandSummary {
  name: string;
  aliases: string[];
  /** Truncated logic, so the prompt stays inside a sane token budget. */
  codePreview: string;
  codeLength: number;
  needReply: boolean;
  parseMode: string;
  /** `true` when the code was truncated for the prompt. */
  truncated: boolean;
}

/** Everything the model needs to know about the user's bot. */
export interface CopilotBotContext {
  botId: number | null;
  botName: string;
  botUsername: string;
  status: "online" | "offline" | "unknown";
  commands: CopilotCommandSummary[];
  /** Variables discovered across all commands (`{{refs}}`, db keys, bindings). */
  variables: string[];
  /** Names only — never the values. */
  envVarNames: string[];
  /** Whether a deployable TeleBotHost key is present. */
  hasWriteKey: boolean;
  /** Folders already in use. */
  folders: string[];
  /** Which surface the user is currently looking at. */
  activeSurface: "builder" | "workflow" | "deploy" | "analytics" | "none";
}

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

export type LlmProviderId = "openai" | "anthropic" | "custom";

export interface LlmProviderDefinition {
  id: LlmProviderId;
  label: string;
  /** Where the key comes from, for the setup UI. */
  keyHint: string;
  keyPrefix?: string;
  /** Chat-completions endpoint. */
  endpoint: string;
  defaultModel: string;
  models: string[];
  docsUrl: string;
}

export interface LlmConfig {
  provider: LlmProviderId;
  apiKey: string;
  model: string;
  /** Only used when `provider === "custom"`. */
  baseUrl?: string;
  /** Optional tuning. */
  temperature?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let counter = 0;

export function createCopilotId(prefix = "msg"): string {
  counter += 1;
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}${counter}`;
}

export function createUserMessage(content: string): CopilotMessage {
  return {
    id: createCopilotId("u"),
    role: "user",
    content,
    createdAt: new Date().toISOString(),
  };
}

export function createAssistantPlaceholder(): CopilotMessage {
  return {
    id: createCopilotId("a"),
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    pending: true,
  };
}
