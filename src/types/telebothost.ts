/**
 * TeleBotHost Developer API types.
 *
 * Every shape here was derived from the live OpenAPI document at
 * https://api.telebothost.com/api/v1/docs/openapi.json (v1.0.1) — these are the
 * real field names, not guesses. Keep this file in sync if the spec moves.
 *
 * Base URL: https://api.telebothost.com/api/v1
 * Auth:     `Authorization: Bearer sk_...`  or  `X-Api-Key: sk_...`
 *           `sk_*` = read+write, `pub_*` = read-only (public endpoints need no auth)
 */

export const TBH_API_BASE = "https://api.telebothost.com/api/v1";

/** Prefix of a developer secret key — required for any write operation. */
export const TBH_SECRET_KEY_PREFIX = "sk_";
/** Prefix of a read-only public key. */
export const TBH_PUBLIC_KEY_PREFIX = "pub_";

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface TbhMeta {
  processing_time_ms: number;
}

/** Every successful TeleBotHost response is wrapped in this envelope. */
export interface TbhSuccess<T> {
  success: true;
  message?: string;
  meta?: TbhMeta;
}

/** The documented error body, returned with 4xx/5xx status codes. */
export interface TbhErrorBody {
  success: false;
  reason?: string;
  message: string;
  hint?: string;
  errors?: Record<string, string>;
  /** Present on 429 responses. */
  retry_after?: number;
  /** Unix timestamp at which the quota window resets. */
  reset_at?: number;
}

/**
 * Rate-limit / quota telemetry. TeleBotHost returns these on *every*
 * authenticated response, so we surface them in the UI rather than hiding them.
 */
export interface TbhRateLimit {
  /** Daily quota ceiling for the current plan tier. */
  limit?: number;
  remaining?: number;
  reset?: number;
  limitMinute?: number;
  remainingMinute?: number;
  resetMinute?: number;
  limitMonth?: number;
  remainingMonth?: number;
  resetMonth?: number;
}

export interface TbhPlanTier {
  name: "FREE" | "PREMIUM" | "ELITE" | "UNKNOWN";
  dailyLimit: number;
  perMinuteLimit: number;
  monthlyLimit: number;
}

/** Documented limits per tier, used to explain quota usage in the dashboard. */
export const TBH_PLAN_TIERS: Record<"FREE" | "PREMIUM" | "ELITE", TbhPlanTier> = {
  FREE: { name: "FREE", dailyLimit: 1000, perMinuteLimit: 15, monthlyLimit: 15000 },
  PREMIUM: { name: "PREMIUM", dailyLimit: 5000, perMinuteLimit: 60, monthlyLimit: 75000 },
  ELITE: { name: "ELITE", dailyLimit: 10000, perMinuteLimit: 120, monthlyLimit: 150000 },
};

/** Hard capacity caps enforced across all plans. */
export const TBH_CAPACITY = {
  maxCommandsPerBot: 1000,
  maxEnvVarsPerBot: 100,
  maxFoldersPerBot: 50,
  /** Individual command code / script size. */
  maxCommandCodeChars: 100_000,
  /** Individual command answer size. */
  maxAnswerChars: 10_000,
  /** Combined command payload per bot. */
  maxCommandPayloadBytes: 10 * 1024 * 1024,
} as const;

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/** `GET /status` — the only unauthenticated probe. Perfect for a cheap ping. */
export interface TbhStatusProbe {
  version: string;
  status: string;
  env: string;
}

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

/**
 * `status` is an integer flag: `1` = running/online, `0` = stopped.
 * It is toggled through `PATCH /bot/{botid}`.
 */
export const TBH_BOT_STATUS = {
  STOPPED: 0,
  RUNNING: 1,
} as const;

export type TbhBotStatus = (typeof TBH_BOT_STATUS)[keyof typeof TBH_BOT_STATUS];

export interface BotListItem {
  bot_id: number;
  name: string;
  photo: string;
  is_transferred: number;
  is_cloned: number;
  is_public_store: number;
  is_template: number;
  tbl_var: string;
  bot_username: string;
  status: number;
  pin: boolean;
  created_at: string;
  updated_at: string;
  blocked: number;
  uptime: string;
  commands_count: number;
}

export interface BotStatsSummary {
  total: number;
  public_store: number;
  transferred: number;
  cloned: number;
  templates: number;
}

export interface ListBotsResponse {
  success: boolean;
  stats: BotStatsSummary;
  bots: BotListItem[];
  meta?: TbhMeta;
}

/** `POST /bot` — register a new bot. */
export interface CreateBotRequest {
  /** BotFather token. */
  bot_token: string;
  bot_name: string;
  /** Start the bot immediately after registration. */
  run_now: boolean;
}

export interface CreateBotResponse {
  success: boolean;
  message: string;
  bot: BotListItem;
  meta?: TbhMeta;
}

/** `PATCH /bot/{botid}` — the only way to start/stop a bot. */
export interface UpdateBotRequest {
  name?: string;
  bot_token?: string;
  pin?: boolean;
  status?: number;
  ads_config?: AdsConfig;
}

export interface UpdateBotResponse {
  success: boolean;
  message: string;
  updated: BotListItem;
  bots: BotListItem[];
  stats: BotStatsSummary;
  meta?: TbhMeta;
}

export interface AdsConfig {
  enabled: boolean;
  commands_interval: number;
  daily_limit: number;
  weekly_limit: number;
  monthly_limit: number;
  /** Documented range: 15 minutes .. 2 hours. */
  cooldown_seconds: number;
  allow_adult: boolean;
  allow_gambling: boolean;
}

// ---------------------------------------------------------------------------
// Commands — the unit the visual builder compiles down to
// ---------------------------------------------------------------------------

export interface CommandFolder {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface TblCommand {
  id: number;
  bot_id: number;
  /** The trigger. `/start`, exact text, `*` wildcard, or `@`. */
  name: string;
  /** TBL JavaScript logic, runs after `answer`. Max 100,000 chars. */
  code: string;
  /** Text sent before logic runs. Max 10,000 chars. */
  answer: string;
  parse_mode: string;
  /** Reply keyboard as a string: `"A, B\nC"`. */
  keyboard: string;
  aliases: string[];
  allow_only_group: boolean;
  need_reply: boolean;
  case_insensitive: boolean;
  /** `1` marks the command as a public web resource served at /public/{bot_id}/{name}. */
  is_web: number;
  folder: string;
  created_at: string;
  updated_at: string;
}

/** `POST /bot/{botid}/commands` */
export interface CreateCommandRequest {
  name: string;
  code?: string;
  answer?: string;
  parse_mode?: string;
  keyboard?: string;
  aliases?: string[];
  allow_only_group?: boolean;
  need_reply?: boolean;
  case_insensitive?: boolean;
  is_web?: number;
  folder?: string;
}

/** `PATCH /bot/{botid}/commands/{commandid}` — all fields optional. */
export type UpdateCommandRequest = Partial<CreateCommandRequest>;

export interface ListCommandsResponse {
  success: boolean;
  commands: TblCommand[];
  folders: CommandFolder[];
  meta?: TbhMeta;
}

export interface CommandMutationResponse {
  success: boolean;
  message: string;
  command: TblCommand;
  meta?: TbhMeta;
}

// ---------------------------------------------------------------------------
// Logs & analytics
// ---------------------------------------------------------------------------

export interface BotLogEntry {
  id: string;
  bot_id: number;
  command: string;
  error_message: string;
  stack: string;
  type: string;
  timezone: string;
  log_timestamp: string;
}

export interface ListLogsResponse {
  success: boolean;
  logs: BotLogEntry[];
  meta?: TbhMeta;
}

export interface BotAnalytics {
  bot_id: number;
  total_users: number;
  active_24h: number;
  active_month: number;
  new_month: number;
  new_today: number;
  premium_users: number;
  private_chats: number;
  group_chats: number;
  channel_chats: number;
  ads_earnings_total: number;
  ads_impressions_total: number;
  ads_earnings_7d: Record<string, number>;
  calculated_at: string;
}

export interface GetAnalyticsResponse {
  success: boolean;
  analytics: BotAnalytics;
  meta?: TbhMeta;
}

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------

export interface BotEnvVar {
  id: number;
  name: string;
  value: string;
  placeholder?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ListEnvResponse {
  success: boolean;
  envs: BotEnvVar[];
  meta?: TbhMeta;
}

export interface CreateEnvRequest {
  name: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Client-facing helpers
// ---------------------------------------------------------------------------

/**
 * Normalised result returned by our own API proxy routes, so the browser never
 * has to reason about raw HTTP status codes or TeleBotHost's error envelope.
 */
export interface ProxyResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: {
    message: string;
    hint?: string;
    reason?: string;
    errors?: Record<string, string>;
    retryAfter?: number;
  };
  rateLimit?: TbhRateLimit;
}

export function isTbhError(value: unknown): value is TbhErrorBody {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.success === false && typeof candidate.message === "string";
}
