/**
 * Human-readable labels for workflow enums.
 *
 * Kept out of the type module so the compiler and the UI can share one vocabulary
 * without pulling UI concerns into the graph logic.
 */

import type {
  ConditionOperator,
  ConditionSubject,
  HttpMethod,
  KeyboardType,
  MediaKind,
  StateValidator,
  TriggerKind,
} from "@/types/workflow";

export const TRIGGER_KIND_LABEL: Record<TriggerKind, string> = {
  command: "Slash command",
  keyword: "Keyword",
  regex: "Regex pattern",
  wildcard: "Wildcard fallback",
  callback: "Button callback",
  inline: "Inline query",
};

export const TRIGGER_KIND_HINT: Record<TriggerKind, string> = {
  command: "Matches /name and /name@YourBot. TBL tries the longest name first.",
  keyword: "Exact text match. Case-sensitive unless you enable ignore case.",
  regex:
    "TBL's router has no regex support, so patterns are folded into the shared * fallback command.",
  wildcard: "The * command — runs when nothing else matches. Only one per bot.",
  callback: "Matches the callback_data of an inline keyboard button.",
  inline: "Routed through TBL's /handle_inline_query dynamic handler.",
};

export const SUBJECT_LABEL: Record<ConditionSubject, string> = {
  message: "the message text",
  params: "the command arguments",
  variable: "a variable",
  chatType: "the chat type",
};

export const OPERATOR_LABEL: Record<ConditionOperator, string> = {
  contains: "contains",
  notContains: "does not contain",
  equals: "equals",
  startsWith: "starts with",
  endsWith: "ends with",
  matchesRegex: "matches regex",
  isTruthy: "is truthy",
  isEmpty: "is empty",
  greaterThan: "is greater than",
  lessThan: "is less than",
};

/** Operators that do not take a comparison value. */
export const UNARY_OPERATORS: ConditionOperator[] = ["isTruthy", "isEmpty"];

export const FIELD_VALIDATOR_META_LABEL: Record<StateValidator, string> = {
  none: "anything",
  text: "non-empty text",
  email: "email",
  phone: "phone",
  number: "number",
  url: "url",
};

export const MEDIA_KIND_LABEL: Record<MediaKind, string> = {
  photo: "Photo",
  document: "Document",
  video: "Video",
  audio: "Audio",
};

export const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** Methods that carry a request body. */
export const METHODS_WITH_BODY: HttpMethod[] = ["POST", "PUT", "PATCH"];

export const KEYBOARD_TYPE_LABEL: Record<KeyboardType, string> = {
  inline: "Inline (inside the message)",
  reply: "Reply (below the input)",
};
