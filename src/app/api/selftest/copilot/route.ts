import { NextResponse } from "next/server";
import { parseCopilotReply, normaliseKeyboard, artifactToCommandPayload } from "@/lib/copilot/schema";
import { buildDeployPayload } from "@/lib/copilot/deploy";
import { collapseUnchanged, diffLines, summariseDiff } from "@/lib/diff";
import { tokeniseJavaScript } from "@/lib/copilot/highlight";
import { buildSystemPrompt, renderBotContext } from "@/lib/copilot/system-prompt";
import { buildBotContext } from "@/lib/copilot/context";
import type { BotListItem, TblCommand } from "@/types/telebothost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dev-only self-test for the copilot's pure logic (404 in production).
 *
 * The LLM itself is non-deterministic and can't be asserted against, but everything
 * *around* it can: the tolerant parser, the keyboard normaliser, the diff engine, the
 * tokeniser, and — most importantly — the exact payload shape sent to TeleBotHost.
 */

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

function check(name: string, passed: boolean, detail = ""): Check {
  return { name, passed, detail };
}

const VALID_REPLY = JSON.stringify({
  explanation: "Sends a greeting.",
  command_name: "/start",
  tbl_code: 'await Api.sendMessage({ text: "Hi" })',
});

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function testParser(): Check[] {
  const results: Check[] = [];

  // -- clean JSON ----------------------------------------------------------
  const clean = parseCopilotReply(VALID_REPLY);
  results.push(
    check(
      "parser: accepts bare JSON",
      Boolean(clean.artifact) && clean.artifact?.command_name === "/start",
      clean.error ?? "",
    ),
  );

  // -- fenced JSON ---------------------------------------------------------
  const fenced = parseCopilotReply("```json\n" + VALID_REPLY + "\n```");
  results.push(
    check(
      "parser: unwraps markdown fences",
      Boolean(fenced.artifact) && fenced.artifact?.command_name === "/start",
      fenced.error ?? "",
    ),
  );

  // -- prose before the JSON ----------------------------------------------
  const chatty = parseCopilotReply(
    `Sure! Here's the command you asked for:\n\n${VALID_REPLY}\n\nLet me know if you want changes.`,
  );
  results.push(
    check(
      "parser: survives prose around the JSON",
      Boolean(chatty.artifact),
      chatty.error ?? "",
    ),
  );

  // -- tbl_code as an array of lines --------------------------------------
  const arrayCode = parseCopilotReply(
    JSON.stringify({
      explanation: "x",
      command_name: "/a",
      tbl_code: ["const a = 1", "await Bot.sendMessage(a)"],
    }),
  );
  results.push(
    check(
      "parser: repairs tbl_code returned as an array",
      arrayCode.artifact?.tbl_code === "const a = 1\nawait Bot.sendMessage(a)" &&
        arrayCode.repairs.length > 0,
      `code=${JSON.stringify(arrayCode.artifact?.tbl_code)} repairs=${JSON.stringify(arrayCode.repairs)}`,
    ),
  );

  // -- nested payload ------------------------------------------------------
  const nested = parseCopilotReply(
    JSON.stringify({ command: { explanation: "n", command_name: "/n", tbl_code: "// n" } }),
  );
  results.push(
    check(
      "parser: unwraps a nested payload object",
      nested.artifact?.command_name === "/n",
      nested.error ?? "",
    ),
  );

  // -- escaped newlines ----------------------------------------------------
  const escaped = parseCopilotReply(
    JSON.stringify({
      explanation: "e",
      command_name: "/e",
      tbl_code: "const a = 1\\nconst b = 2",
    }),
  );
  results.push(
    check(
      "parser: converts escaped newlines in code",
      escaped.artifact?.tbl_code === "const a = 1\nconst b = 2",
      `code=${JSON.stringify(escaped.artifact?.tbl_code)}`,
    ),
  );

  // -- brace inside a string must not end the object -----------------------
  const bracesInString = parseCopilotReply(
    '{"explanation":"has } brace","command_name":"/b","tbl_code":"const x = \\"{ }\\""}',
  );
  results.push(
    check(
      "parser: ignores braces inside string literals",
      bracesInString.artifact?.command_name === "/b",
      bracesInString.error ?? "",
    ),
  );

  // -- missing command_name is a clear error -------------------------------
  const noName = parseCopilotReply('{"explanation":"x","tbl_code":"// x"}');
  results.push(
    check(
      "parser: reports a missing command_name",
      !noName.artifact && Boolean(noName.error),
      noName.error ?? "",
    ),
  );

  // -- invalid JSON --------------------------------------------------------
  const broken = parseCopilotReply("I cannot help with that.");
  results.push(
    check(
      "parser: reports unparseable replies",
      !broken.artifact && Boolean(broken.error),
      broken.error ?? "",
    ),
  );

  // -- empty ---------------------------------------------------------------
  const empty = parseCopilotReply("");
  results.push(
    check("parser: rejects an empty reply", !empty.artifact && Boolean(empty.error)),
  );

  return results;
}

// ---------------------------------------------------------------------------
// Keyboard normaliser
// ---------------------------------------------------------------------------

function testKeyboard(): Check[] {
  const results: Check[] = [];

  const asString = normaliseKeyboard("Help, About\nSettings");
  results.push(
    check(
      "keyboard: parses a TBL keyboard string",
      asString?.kind === "reply" && asString.rows.length === 2 && asString.tblKeyboard === "Help, About\nSettings",
      JSON.stringify(asString),
    ),
  );

  const grid = normaliseKeyboard([
    ["A", "B"],
    ["C"],
  ]);
  results.push(
    check(
      "keyboard: parses an array-of-rows reply grid",
      grid?.kind === "reply" && grid.tblKeyboard === "A, B\nC",
      JSON.stringify(grid),
    ),
  );

  const replyMarkup = normaliseKeyboard({
    keyboard: [[{ text: "Yes" }, { text: "No" }]],
    resize_keyboard: true,
  });
  results.push(
    check(
      "keyboard: parses a Telegram reply_markup object",
      replyMarkup?.kind === "reply" && replyMarkup.tblKeyboard === "Yes, No",
      JSON.stringify(replyMarkup),
    ),
  );

  const inline = normaliseKeyboard({
    inline_keyboard: [[{ text: "Yes", callback_data: "y" }, { text: "Site", url: "https://x.com" }]],
  });
  results.push(
    check(
      "keyboard: flags an inline keyboard with a warning",
      inline?.kind === "inline" && inline.tblKeyboard === "" && Boolean(inline.warning),
      JSON.stringify(inline),
    ),
  );

  const inlineRows = normaliseKeyboard([[{ text: "A", callback_data: "a" }]]);
  results.push(
    check(
      "keyboard: detects inline buttons inside a bare array",
      inlineRows?.kind === "inline" && Boolean(inlineRows.warning),
      JSON.stringify(inlineRows),
    ),
  );

  results.push(check("keyboard: returns null for undefined", normaliseKeyboard(undefined) === null));
  results.push(check("keyboard: returns null for an empty string", normaliseKeyboard("") === null));

  return results;
}

// ---------------------------------------------------------------------------
// Deploy payload — the regression guard for the corrected API shape
// ---------------------------------------------------------------------------

function testDeployPayload(): Check[] {
  const results: Check[] = [];

  const payload = buildDeployPayload({
    explanation: "x",
    command_name: "/start",
    tbl_code: "// hello",
    answer: "Hi",
    parse_mode: "Markdown",
    need_reply: false,
    aliases: ["Start"],
  });

  const keys = Object.keys(payload);

  // The spec this was built from used `logic`; the real TeleBotHost schema uses `code`.
  results.push(
    check(
      "payload: uses `code`, not `logic` (real TeleBotHost schema)",
      "code" in payload && !("logic" in payload) && payload.code === "// hello",
      `keys=${keys.join(",")}`,
    ),
  );

  results.push(
    check(
      "payload: carries the documented field set",
      ["name", "code", "answer", "parse_mode", "keyboard", "aliases", "need_reply"].every((key) =>
        keys.includes(key),
      ),
      `keys=${keys.join(",")}`,
    ),
  );

  results.push(
    check(
      "payload: does not invent an api_key field (auth is a header)",
      !keys.some((key) => key.toLowerCase().includes("key") && key !== "keyboard"),
      `keys=${keys.join(",")}`,
    ),
  );

  const replyKeyboard = buildDeployPayload({
    explanation: "x",
    command_name: "/k",
    tbl_code: "",
    keyboard: [["A", "B"]],
  });
  results.push(
    check(
      "payload: reply keyboard lands in the `keyboard` field",
      replyKeyboard.keyboard === "A, B",
      `keyboard=${JSON.stringify(replyKeyboard.keyboard)}`,
    ),
  );

  const inlineKeyboard = buildDeployPayload({
    explanation: "x",
    command_name: "/i",
    tbl_code: "// i",
    keyboard: { inline_keyboard: [[{ text: "A", callback_data: "a" }]] },
  });
  results.push(
    check(
      "payload: inline keyboard is NOT put in the `keyboard` field",
      inlineKeyboard.keyboard === "",
      `keyboard=${JSON.stringify(inlineKeyboard.keyboard)}`,
    ),
  );

  // artifactToCommandPayload must agree with buildDeployPayload.
  const direct = artifactToCommandPayload({
    explanation: "x",
    command_name: "/d",
    tbl_code: "// d",
  });
  results.push(
    check(
      "payload: both builders agree on the field name",
      "code" in direct && direct.code === "// d",
      `keys=${Object.keys(direct).join(",")}`,
    ),
  );

  return results;
}

// ---------------------------------------------------------------------------
// Diff engine
// ---------------------------------------------------------------------------

function testDiff(): Check[] {
  const results: Check[] = [];

  const same = diffLines("a\nb\nc", "a\nb\nc");
  results.push(
    check(
      "diff: identical text produces no changes",
      summariseDiff(same).identical && same.every((line) => line.kind === "same"),
      JSON.stringify(summariseDiff(same)),
    ),
  );

  const added = diffLines("", "a\nb");
  results.push(
    check(
      "diff: empty old side marks everything added",
      summariseDiff(added).added === 2 && summariseDiff(added).removed === 0,
      JSON.stringify(summariseDiff(added)),
    ),
  );

  const removed = diffLines("a\nb", "");
  results.push(
    check(
      "diff: empty new side marks everything removed",
      summariseDiff(removed).removed === 2,
      JSON.stringify(summariseDiff(removed)),
    ),
  );

  const modified = diffLines("const a = 1\nconst b = 2", "const a = 1\nconst b = 99");
  const stats = summariseDiff(modified);
  results.push(
    check(
      "diff: a one-line change reports one add and one remove",
      stats.added === 1 && stats.removed === 1 && stats.unchanged === 1,
      JSON.stringify(stats),
    ),
  );

  // Line numbers must track both sides so the gutter is readable.
  const numbered = diffLines("x\ny", "x\nz");
  const addedLine = numbered.find((line) => line.kind === "added");
  const removedLine = numbered.find((line) => line.kind === "removed");
  results.push(
    check(
      "diff: added and removed lines carry their line numbers",
      addedLine?.newLine === 2 && removedLine?.oldLine === 2,
      `added=${JSON.stringify(addedLine)} removed=${JSON.stringify(removedLine)}`,
    ),
  );

  // Collapsing long unchanged runs.
  const longSame = Array.from({ length: 60 }, (_, index) => `line ${index}`).join("\n");
  const withChange = `${longSame}\nconst changed = true`;
  const collapsed = collapseUnchanged(diffLines(longSame, withChange));
  const gaps = collapsed.items.filter((item) => item.kind === "gap");
  results.push(
    check(
      "diff: long unchanged runs collapse into a gap",
      gaps.length === 1 && gaps[0]?.kind === "gap" && gaps[0].count > 40,
      `items=${collapsed.items.length} gaps=${JSON.stringify(gaps)}`,
    ),
  );

  const shortRun = collapseUnchanged(diffLines("a\nb\nc", "a\nB\nc"));
  results.push(
    check(
      "diff: short unchanged runs are not collapsed",
      shortRun.items.every((item) => item.kind !== "gap"),
      JSON.stringify(shortRun.items),
    ),
  );

  // CRLF normalisation — a Windows-saved script must not diff entirely.
  const crlf = diffLines("a\r\nb", "a\nb");
  results.push(
    check(
      "diff: CRLF and LF are treated as equal",
      summariseDiff(crlf).identical,
      JSON.stringify(summariseDiff(crlf)),
    ),
  );

  return results;
}

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------

function testTokeniser(): Check[] {
  const results: Check[] = [];

  const code = `// comment\nconst x = await db.user.get("k", 0)\nawait Bot.sendMessage("hi")`;
  const tokens = tokeniseJavaScript(code);

  // Round-trip fidelity is the one thing a highlighter must never break.
  results.push(
    check(
      "tokeniser: output round-trips to the original source",
      tokens.map((token) => token.text).join("") === code,
      "reconstruction differed",
    ),
  );

  const kinds = new Set(tokens.map((token) => token.kind));
  results.push(
    check(
      "tokeniser: classifies comments, strings, keywords and globals",
      kinds.has("comment") && kinds.has("string") && kinds.has("keyword") && kinds.has("global"),
      `kinds=${[...kinds].join(",")}`,
    ),
  );

  results.push(
    check(
      "tokeniser: classifies TBL globals distinctly from plain identifiers",
      tokens.some((token) => token.kind === "global" && token.text === "Bot") &&
        tokens.some((token) => token.kind === "global" && token.text === "db"),
      "no global tokens found",
    ),
  );

  results.push(
    check(
      "tokeniser: handles an unterminated string without throwing",
      (() => {
        try {
          tokeniseJavaScript('const a = "unterminated');
          return true;
        } catch {
          return false;
        }
      })(),
    ),
  );

  results.push(check("tokeniser: handles empty input", tokeniseJavaScript("").length === 0));

  return results;
}

// ---------------------------------------------------------------------------
// Context builder and prompt
// ---------------------------------------------------------------------------

function makeCommand(name: string, code: string, extra: Partial<TblCommand> = {}): TblCommand {
  return {
    id: 1,
    bot_id: 1,
    name,
    code,
    answer: "",
    parse_mode: "Markdown",
    keyboard: "",
    aliases: [],
    allow_only_group: false,
    need_reply: false,
    case_insensitive: false,
    is_web: 0,
    folder: "",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

function makeBot(overrides: Partial<BotListItem> = {}): BotListItem {
  return {
    bot_id: 1,
    name: "Bot",
    photo: "",
    is_transferred: 0,
    is_cloned: 0,
    is_public_store: 0,
    is_template: 0,
    tbl_var: "",
    bot_username: "bot",
    status: 0,
    pin: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    blocked: 0,
    uptime: "",
    commands_count: 0,
    ...overrides,
  };
}

function testContextAndPrompt(): Check[] {
  const results: Check[] = [];

  const commands = [
    makeCommand("/start", 'const a = await db.user.get("greeted", false)'),
    makeCommand("/buy", 'const key = process.env.PAYMENT_API_KEY\nawait db.bot.incr("purchases")'),
  ];

  const context = buildBotContext({
    bot: makeBot({ bot_id: 42, name: "Test Bot", bot_username: "test_bot", status: 1 }),
    commands,
    envVars: [],
    hasWriteKey: true,
    activeSurface: "builder",
  });

  results.push(
    check(
      "context: captures bot identity",
      context.botId === 42 && context.botUsername === "test_bot" && context.status === "online",
      JSON.stringify({ id: context.botId, status: context.status }),
    ),
  );

  results.push(
    check(
      "context: extracts db keys as variables",
      context.variables.includes("greeted") && context.variables.includes("purchases"),
      `variables=${JSON.stringify(context.variables)}`,
    ),
  );

  results.push(
    check(
      "context: extracts env var names from code",
      context.envVarNames.includes("PAYMENT_API_KEY"),
      `env=${JSON.stringify(context.envVarNames)}`,
    ),
  );

  results.push(
    check(
      "context: never includes secret values",
      !JSON.stringify(context).includes("sk_") && !JSON.stringify(context).includes("token"),
      "possible secret leak in context",
    ),
  );

  // -- truncation budget ---------------------------------------------------
  const many = Array.from({ length: 100 }, (_, index) =>
    makeCommand(`/cmd${index}`, "x".repeat(2000)),
  );
  const trimmed = buildBotContext({
    bot: makeBot(),
    commands: many,
    hasWriteKey: false,
    activeSurface: "none",
    maxCommands: 10,
    maxCodePreview: 100,
  });

  results.push(
    check(
      "context: respects the command budget",
      trimmed.commands.length === 10,
      `included=${trimmed.commands.length}`,
    ),
  );

  results.push(
    check(
      "context: marks truncated code previews",
      trimmed.commands.every((command) => command.truncated && command.codePreview.length <= 100),
      "truncation flag missing",
    ),
  );

  // -- prompt assembly -----------------------------------------------------
  const prompt = buildSystemPrompt(context);
  const required = [
    "Api.sendMessage",
    "Bot.sendMessage",
    "db.user",
    "db.bot",
    "process.env",
    "need_reply",
    "command_name",
    "tbl_code",
    "explanation",
  ];
  const missing = required.filter((needle) => !prompt.includes(needle));

  results.push(
    check(
      "prompt: encodes the real TBL globals and the output contract",
      missing.length === 0,
      `missing=${missing.join(",")}`,
    ),
  );

  results.push(
    check(
      "prompt: injects the live bot context",
      prompt.includes("test_bot") && prompt.includes("/start") && prompt.includes("42"),
      "context not present in prompt",
    ),
  );

  const emptyContext = buildBotContext({
    bot: null,
    commands: [],
    hasWriteKey: false,
    activeSurface: "none",
  });
  const rendered = renderBotContext(emptyContext);
  results.push(
    check(
      "prompt: handles the no-bot case explicitly",
      rendered.includes("No bot is selected"),
      rendered.slice(0, 80),
    ),
  );

  return results;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let checks: Check[] = [];
  const runnerErrors: string[] = [];

  const suites: [string, () => Check[]][] = [
    ["parser", testParser],
    ["keyboard", testKeyboard],
    ["deploy-payload", testDeployPayload],
    ["diff", testDiff],
    ["tokeniser", testTokeniser],
    ["context-prompt", testContextAndPrompt],
  ];

  for (const [label, suite] of suites) {
    try {
      checks = checks.concat(suite());
    } catch (error) {
      runnerErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const failed = checks.filter((item) => !item.passed);

  return NextResponse.json({
    behaviour: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
      runnerErrors,
      checks,
    },
    allBehaviourPassed: failed.length === 0 && runnerErrors.length === 0,
  });
}
