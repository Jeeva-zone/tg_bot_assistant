/**
 * Parsing the model's reply.
 *
 * The output contract asks for bare JSON, but models wrap it in markdown fences,
 * prepend "Here you go!", or return `tbl_code` as an array of lines. A strict
 * `JSON.parse` would throw on all of those and the user would see a useless error.
 *
 * So this module is deliberately **tolerant on input, strict on output**: it recovers
 * a JSON object from messy text, repairs a small set of known deviations, then
 * validates the result. Anything it cannot repair becomes a clear, actionable message
 * rather than a stack trace.
 */

import { z } from "zod";
import type { CopilotArtifact, NormalisedKeyboard } from "@/types/copilot";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const artifactSchema = z.object({
  explanation: z.string().min(1).optional(),
  command_name: z.string().min(1).optional(),
  tbl_code: z.string().optional(),
  answer: z.string().optional(),
  parse_mode: z.enum(["Markdown", "MarkdownV2", "HTML"]).optional(),
  need_reply: z.boolean().optional(),
  aliases: z.array(z.string()).optional(),
  keyboard: z.unknown().optional(),
  notes: z.array(z.string()).optional(),
});

export interface ParseResult {
  artifact?: CopilotArtifact;
  /** Human-readable reason parsing failed. */
  error?: string;
  /** The raw reply, so the UI can always show what the model actually said. */
  raw: string;
  /** Repairs that were applied, surfaced to the user for transparency. */
  repairs: string[];
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/** Strip ```json … ``` or ``` … ``` fences. */
function stripFences(text: string): string {
  const fenced = text.match(/```(?:json|javascript|js)?\s*\n?([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  return text.trim();
}

/**
 * Pull the first balanced `{ … }` out of a string.
 *
 * Brace counting is string-aware so a `}` inside a TBL string literal — which is
 * common, e.g. `reply_markup: { ... }` inside a quoted template — does not end the
 * object early.
 */
function extractBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      if (inString) escaped = true;
      continue;
    }

    if (inString) {
      if (char === quote) inString = false;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

/** Models sometimes emit `\n` as a literal backslash-n inside a JSON string. */
function normaliseEscapes(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function parseCopilotReply(rawReply: string): ParseResult {
  const raw = rawReply ?? "";
  const repairs: string[] = [];

  if (!raw.trim()) {
    return { raw, repairs, error: "The model returned an empty response." };
  }

  const candidate = extractBalancedObject(stripFences(raw)) ?? stripFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    return {
      raw,
      repairs,
      error:
        "The model's reply was not valid JSON, so it could not be turned into a command. " +
        "Try rephrasing, or ask it to reply with JSON only.",
    };
  }

  // -- repair: tbl_code returned as an array of lines ----------------------
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;

    if (Array.isArray(record.tbl_code)) {
      record.tbl_code = record.tbl_code.map(String).join("\n");
      repairs.push("Joined the code back together — the model returned it as an array of lines.");
    }

    if (Array.isArray(record.explanation)) {
      record.explanation = record.explanation.map(String).join(" ");
      repairs.push("Joined the explanation back together.");
    }

    if (typeof record.command_name === "string") {
      record.command_name = record.command_name.trim();
    }

    // Some models nest the payload under "command" or "result".
    if (!record.command_name && !record.tbl_code) {
      for (const key of ["command", "result", "data", "output"]) {
        const nested = record[key];
        if (nested && typeof nested === "object") {
          Object.assign(record, nested as Record<string, unknown>);
          repairs.push(`Unwrapped the payload from the "${key}" field.`);
          break;
        }
      }
    }

    // A literal backslash-n inside the code is a very common escaping slip.
    if (typeof record.tbl_code === "string" && !record.tbl_code.includes("\n") && record.tbl_code.includes("\\n")) {
      record.tbl_code = normaliseEscapes(record.tbl_code);
      repairs.push("Converted escaped newlines in the code.");
    }

    // `answer` sometimes arrives as null rather than omitted.
    if (record.answer === null) delete record.answer;
    if (record.keyboard === null) delete record.keyboard;
  }

  const validated = artifactSchema.safeParse(parsed);
  if (!validated.success) {
    const first = validated.error.issues[0];
    return {
      raw,
      repairs,
      error: `The model's JSON did not match the expected shape${first ? ` (${first.path.join(".") || "root"}: ${first.message})` : ""}.`,
    };
  }

  const data = validated.data;

  if (!data.command_name) {
    return {
      raw,
      repairs,
      error:
        "The model did not say which trigger to use (`command_name`), so there is nothing to deploy.",
    };
  }

  const artifact: CopilotArtifact = {
    explanation: data.explanation ?? "Here is the command.",
    command_name: data.command_name,
    tbl_code: data.tbl_code ?? "",
    answer: data.answer,
    parse_mode: data.parse_mode,
    need_reply: data.need_reply,
    aliases: data.aliases?.map((alias) => alias.trim()).filter(Boolean),
    keyboard: data.keyboard,
    notes: data.notes?.filter(Boolean),
  };

  if (!artifact.tbl_code.trim() && !artifact.answer?.trim()) {
    return {
      raw,
      repairs,
      error:
        "The model returned neither code nor an answer, so the command would do nothing.",
    };
  }

  return { artifact, raw, repairs };
}

// ---------------------------------------------------------------------------
// Keyboard normalisation
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reduce whatever the model returned in `keyboard` to something we can render and
 * deploy.
 *
 * TeleBotHost's `keyboard` field is a plain string (`"A, B\nC"`) and only carries
 * **reply** keyboards. Inline keyboards have to be built inside the code, so when one
 * arrives here we surface a warning instead of silently dropping it.
 */
export function normaliseKeyboard(keyboard: unknown): NormalisedKeyboard | null {
  if (keyboard === undefined || keyboard === null) return null;

  // -- already a TBL keyboard string ---------------------------------------
  if (typeof keyboard === "string") {
    const trimmed = keyboard.trim();
    if (!trimmed) return null;

    const rows = trimmed.split("\n").map((row) => row.split(",").map((cell) => cell.trim()));
    return { kind: "reply", rows, tblKeyboard: trimmed };
  }

  // -- a Telegram reply_markup object --------------------------------------
  if (isRecord(keyboard)) {
    if (Array.isArray(keyboard.inline_keyboard)) {
      const rows = (keyboard.inline_keyboard as unknown[][]).map((row) =>
        row.map((button) => (isRecord(button) ? String(button.text ?? "?") : String(button))),
      );
      return {
        kind: "inline",
        rows,
        tblKeyboard: "",
        warning:
          "This is an inline keyboard, and TeleBotHost's `keyboard` field only carries reply keyboards. " +
          "Inline buttons must be sent from the code via `reply_markup` — if the generated code does not " +
          "already do that, ask the AI to move them into the code.",
      };
    }

    if (Array.isArray(keyboard.keyboard)) {
      const rows = (keyboard.keyboard as unknown[][]).map((row) =>
        row.map((button) => (isRecord(button) ? String(button.text ?? "?") : String(button))),
      );
      return {
        kind: "reply",
        rows,
        tblKeyboard: rows.map((row) => row.join(", ")).join("\n"),
      };
    }
  }

  // -- an array of rows ----------------------------------------------------
  if (Array.isArray(keyboard)) {
    const rows = (keyboard as unknown[]).map((row) => {
      if (Array.isArray(row)) {
        return row.map((cell) =>
          isRecord(cell) ? String(cell.text ?? "?") : String(cell),
        );
      }
      return [String(row)];
    });

    const flat = (keyboard as unknown[]).flat();
    const hasInlineOnly = flat.some(
      (cell) => isRecord(cell) && ("callback_data" in cell || "url" in cell || "web_app" in cell),
    );

    if (hasInlineOnly) {
      return {
        kind: "inline",
        rows,
        tblKeyboard: "",
        warning:
          "Inline keyboard detected. Its buttons must be sent from the code via `reply_markup`.",
      };
    }

    return {
      kind: "reply",
      rows,
      tblKeyboard: rows.map((row) => row.join(", ")).join("\n"),
    };
  }

  return null;
}

/**
 * Build the TeleBotHost command payload from an artifact.
 *
 * Field names here are the real ones from the live OpenAPI spec: the code field is
 * `code`, **not** `logic`.
 */
export function artifactToCommandPayload(artifact: CopilotArtifact): {
  name: string;
  code: string;
  answer: string;
  parse_mode: string;
  keyboard: string;
  aliases: string[];
  need_reply: boolean;
  case_insensitive: boolean;
  allow_only_group: boolean;
  is_web: number;
  folder: string;
} {
  const normalised = normaliseKeyboard(artifact.keyboard);

  return {
    name: artifact.command_name.trim(),
    code: artifact.tbl_code ?? "",
    answer: artifact.answer ?? "",
    parse_mode: artifact.parse_mode ?? "Markdown",
    // Only reply keyboards can ride on this field.
    keyboard: normalised?.kind === "reply" ? normalised.tblKeyboard : "",
    aliases: artifact.aliases ?? [],
    need_reply: artifact.need_reply ?? false,
    case_insensitive: false,
    allow_only_group: false,
    is_web: 0,
    folder: "",
  };
}
