/**
 * Subset of the Telegram Bot API types that this builder actually needs.
 *
 * We only model what the UI renders and what we send. Anything we do not touch
 * is intentionally omitted rather than typed as `any`, so the compiler catches
 * real mistakes in the builder's generated TBL code.
 *
 * @see https://core.telegram.org/bots/api
 */

export type TelegramParseMode = "Markdown" | "MarkdownV2" | "HTML";

/** Formatting mode accepted by the TeleBotHost `parse_mode` command field. */
export type TblParseMode = "Markdown" | "HTML" | "MarkdownV2";

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export type TelegramChatType = "private" | "group" | "supergroup" | "channel";

export interface TelegramChat {
  id: number;
  type: TelegramChatType;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  from?: TelegramUser;
  chat: TelegramChat;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  reply_to_message?: TelegramMessage;
}

/** A button shown on the persistent keyboard beneath the chat input. */
export interface KeyboardButton {
  text: string;
  request_contact?: boolean;
  request_location?: boolean;
}

export interface ReplyKeyboardMarkup {
  keyboard: KeyboardButton[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  selective?: boolean;
  input_field_placeholder?: string;
}

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
  web_app?: { url: string };
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export type TelegramReplyMarkup = ReplyKeyboardMarkup | InlineKeyboardMarkup;

/** The `getMe` payload — used to validate a BotFather token instantly. */
export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
  can_connect_to_business?: boolean;
  has_main_web_app?: boolean;
}

/**
 * A BotFather token looks like `123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw`.
 * The bot id is the numeric prefix, which is also useful for a quick sanity check.
 */
export const BOT_TOKEN_PATTERN = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;

export function isPlausibleBotToken(token: string): boolean {
  return BOT_TOKEN_PATTERN.test(token.trim());
}

/** Extract the numeric bot id from a BotFather token, or `null` if malformed. */
export function parseBotIdFromToken(token: string): number | null {
  const match = token.trim().match(/^(\d{6,}):/);
  if (!match?.[1]) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}
