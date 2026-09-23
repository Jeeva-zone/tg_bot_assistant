import { NextResponse } from "next/server";
import { compileProject } from "@/lib/compiler";
import {
  createCommandNode,
  createId,
  createProject,
  type BotProject,
} from "@/types/builder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TEMPORARY self-test route.
 *
 * Two layers of verification, because they catch different things:
 *   1. Syntax check — constructs the generated code as a Function (parses only).
 *   2. Execution check — runs it against mocked TBL globals and asserts on the
 *      resulting behaviour. A syntax check happily accepts `val.length` even when
 *      the declared variable is `__val`; only running it catches that.
 *
 * Deleted before commit.
 */

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function buildFixture(): BotProject {
  const base = createProject("Fixture Bot");

  const simple = createCommandNode({
    label: "Start",
    trigger: { kind: "command", value: "/start", caseInsensitive: false },
    response: {
      text: "Welcome!",
      parseMode: "Markdown",
      media: [],
      inlineKeyboard: { enabled: false, rows: [] },
    },
  });

  const rich = createCommandNode({
    label: "Menu",
    trigger: { kind: "command", value: "/menu", caseInsensitive: false },
    response: {
      text: "*Choose:*",
      parseMode: "Markdown",
      media: [
        { id: createId("m"), kind: "photo", source: "https://example.com/a.png", caption: "Hi" },
      ],
      inlineKeyboard: {
        enabled: true,
        rows: [
          [
            { id: createId("b"), text: "Yes", action: "callback", value: "confirm" },
            { id: createId("b"), text: "Site", action: "url", value: "https://example.com" },
          ],
        ],
      },
    },
    aliases: ["Menu", "/m"],
  });

  const simpleKeyboard = createCommandNode({
    label: "Help",
    trigger: { kind: "keyword", value: "Help", caseInsensitive: false },
    response: {
      text: "Pick one",
      parseMode: "Markdown",
      media: [],
      inlineKeyboard: { enabled: false, rows: [] },
    },
    keyboard: {
      enabled: true,
      rows: [["Help", "About"], ["Settings"]],
      resize: true,
      oneTime: false,
      placeholder: "",
    },
  });

  const customKeyboard = createCommandNode({
    label: "Custom KB",
    trigger: { kind: "command", value: "/custom", caseInsensitive: false },
    response: {
      text: "Custom options",
      parseMode: "HTML",
      media: [],
      inlineKeyboard: { enabled: false, rows: [] },
    },
    keyboard: {
      enabled: true,
      rows: [["One", "Two"]],
      resize: false,
      oneTime: true,
      placeholder: "Choose…",
    },
  });

  const flow = createCommandNode({
    label: "Signup",
    trigger: { kind: "command", value: "/signup", caseInsensitive: false },
    needReply: true,
    flow: {
      enabled: true,
      scope: "user",
      completionMessage: "Saved! Send /start to return to the menu.",
      steps: [
        { id: createId("s"), key: "name", prompt: "What's your name?", validator: "text", required: true, errorMessage: "" },
        { id: createId("s"), key: "email", prompt: "Email address?", validator: "email", required: true, errorMessage: "That isn't a valid email." },
        { id: createId("s"), key: "phone", prompt: "Phone?", validator: "phone", required: false, errorMessage: "" },
      ],
    },
  });

  const regex = createCommandNode({
    label: "Order regex",
    trigger: { kind: "regex", value: "^order\\s+(\\d+)$", caseInsensitive: true },
    response: {
      text: "Looking up your order…",
      parseMode: "Markdown",
      media: [],
      inlineKeyboard: { enabled: false, rows: [] },
    },
  });

  const wildcard = createCommandNode({
    label: "Fallback",
    trigger: { kind: "wildcard", value: "*", caseInsensitive: false },
    response: {
      text: "I didn't get that.",
      parseMode: "Markdown",
      media: [],
      inlineKeyboard: { enabled: false, rows: [] },
    },
  });

  const callback = createCommandNode({
    label: "Confirm",
    trigger: { kind: "callback", value: "confirm", caseInsensitive: false },
    response: {
      text: "Confirmed!",
      parseMode: "Markdown",
      media: [],
      inlineKeyboard: { enabled: false, rows: [] },
    },
  });

  const duplicate = createCommandNode({
    label: "Duplicate start",
    trigger: { kind: "command", value: "/start", caseInsensitive: false },
  });

  const disabled = createCommandNode({
    label: "Disabled",
    trigger: { kind: "command", value: "/off", caseInsensitive: false },
    enabled: false,
  });

  return {
    ...base,
    commands: [
      simple,
      rich,
      simpleKeyboard,
      customKeyboard,
      flow,
      regex,
      wildcard,
      callback,
      duplicate,
      disabled,
    ],
  };
}

// ---------------------------------------------------------------------------
// Syntax check
// ---------------------------------------------------------------------------

function syntaxCheck(code: string): { ok: boolean; error?: string } {
  try {
    new Function(`return (async () => {\n${code}\n})()`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "parse error" };
  }
}

// ---------------------------------------------------------------------------
// Execution harness — mocks the TBL globals
// ---------------------------------------------------------------------------

interface Harness {
  sent: string[];
  media: string[];
  callbacks: number;
  store: Map<string, unknown>;
  run: (code: string, message: string) => Promise<void>;
}

function createHarness(): Harness {
  const sent: string[] = [];
  const media: string[] = [];
  const store = new Map<string, unknown>();
  let callbacks = 0;

  const scope = {
    get: async (key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback),
    set: async (key: string, value: unknown) => {
      if (value === null || value === undefined || value === "") store.delete(key);
      else store.set(key, value);
      return { ok: true };
    },
    del: async (key: string) => {
      store.delete(key);
      return { ok: true };
    },
    has: async (key: string) => store.has(key),
  };

  const Bot = {
    sendMessage: (text: unknown) => {
      sent.push(String(text));
    },
    sendKeyboard: (text: unknown) => {
      sent.push(String(text));
    },
    inspect: (...values: unknown[]) => {
      sent.push(values.map(String).join(" "));
    },
    runCommand: async () => ({ success: true }),
  };

  const Api = {
    sendMessage: (payload: { text?: string }) => {
      sent.push(String(payload?.text ?? ""));
      return Promise.resolve({ ok: true });
    },
    sendPhoto: (payload: { photo?: string; caption?: string }) => {
      media.push(`photo:${payload?.photo ?? ""}`);
      if (payload?.caption) sent.push(String(payload.caption));
      return Promise.resolve({ ok: true });
    },
    sendDocument: () => Promise.resolve({ ok: true }),
    sendVideo: () => Promise.resolve({ ok: true }),
    sendAudio: () => Promise.resolve({ ok: true }),
    answerCallbackQuery: () => {
      callbacks += 1;
      return Promise.resolve({ ok: true });
    },
  };

  async function run(code: string, message: string) {
    const factory = new Function(
      "Bot",
      "Api",
      "db",
      "user",
      "chat",
      "message",
      "params",
      `return (async () => {\n${code}\n})()`,
    );
    await factory(
      Bot,
      Api,
      { user: scope, bot: scope, global: scope },
      { id: 1, first_name: "Test" },
      { id: 1, type: "private" },
      message,
      "",
    );
  }

  return {
    sent,
    media,
    store,
    get callbacks() {
      return callbacks;
    },
    run,
  };
}

// ---------------------------------------------------------------------------
// Behaviour assertions
// ---------------------------------------------------------------------------

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

async function testFlow(code: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const h = createHarness();

  await h.run(code, "");
  results.push({
    name: "flow: asks step 1",
    passed: h.sent[0] === "What's your name?",
    detail: `got ${JSON.stringify(h.sent[0])}`,
  });

  h.sent.length = 0;
  await h.run(code, "Alice");
  results.push({
    name: "flow: advances to step 2",
    passed: h.sent[0] === "Email address?",
    detail: `got ${JSON.stringify(h.sent[0])}`,
  });

  h.sent.length = 0;
  await h.run(code, "not-an-email");
  results.push({
    name: "flow: rejects invalid email and re-asks",
    passed: h.sent[0] === "That isn't a valid email." && h.sent[1] === "Email address?",
    detail: `got ${JSON.stringify(h.sent)}`,
  });

  h.sent.length = 0;
  await h.run(code, "alice@example.com");
  results.push({
    name: "flow: accepts valid email, advances to step 3",
    passed: h.sent[0] === "Phone?",
    detail: `got ${JSON.stringify(h.sent[0])}`,
  });

  h.sent.length = 0;
  await h.run(code, "");
  results.push({
    name: "flow: optional field skipped, completion reached with collected data",
    passed:
      h.sent.some((line) => line.includes("Saved!")) &&
      h.sent.some((line) => line.includes("alice@example.com")),
    detail: `got ${JSON.stringify(h.sent)}`,
  });

  results.push({
    name: "flow: state cleared after completion",
    passed: h.store.size === 0,
    detail: `store has ${h.store.size} key(s)`,
  });

  const h2 = createHarness();
  await h2.run(code, "");
  results.push({
    name: "flow: fresh session starts at step 1",
    passed: h2.sent[0] === "What's your name?",
    detail: `got ${JSON.stringify(h2.sent[0])}`,
  });

  return results;
}

async function testRich(code: string): Promise<CheckResult[]> {
  const h = createHarness();
  await h.run(code, "");

  return [
    {
      name: "rich: sends media attachment",
      passed: h.media.length === 1,
      detail: `media=${JSON.stringify(h.media)}`,
    },
    {
      name: "rich: sends text with inline keyboard",
      passed: h.sent.some((line) => line.includes("Choose:")),
      detail: `sent=${JSON.stringify(h.sent)}`,
    },
  ];
}

async function testDispatcher(code: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const match = createHarness();
  await match.run(code, "order 42");
  results.push({
    name: "dispatcher: regex rule matches",
    passed: match.sent.some((line) => line.includes("Looking up your order")),
    detail: `sent=${JSON.stringify(match.sent)}`,
  });

  const noMatch = createHarness();
  await noMatch.run(code, "hello there");
  results.push({
    name: "dispatcher: falls through to wildcard",
    passed:
      noMatch.sent.some((line) => line.includes("didn't get that")) &&
      !noMatch.sent.some((line) => line.includes("Looking up")),
    detail: `sent=${JSON.stringify(noMatch.sent)}`,
  });

  const caseInsensitive = createHarness();
  await caseInsensitive.run(code, "ORDER 7");
  results.push({
    name: "dispatcher: honours case-insensitive flag",
    passed: caseInsensitive.sent.some((line) => line.includes("Looking up your order")),
    detail: `sent=${JSON.stringify(caseInsensitive.sent)}`,
  });

  return results;
}

async function testCallback(code: string): Promise<CheckResult[]> {
  const h = createHarness();
  await h.run(code, "");

  return [
    {
      name: "callback: acknowledges the callback query",
      passed: h.callbacks === 1,
      detail: `answerCallbackQuery called ${h.callbacks} time(s)`,
    },
    {
      name: "callback: sends the response text",
      passed: h.sent.some((line) => line.includes("Confirmed!")),
      detail: `sent=${JSON.stringify(h.sent)}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function GET() {
  // Dev-only. This exercises the compiler with a fixture and mocks the TBL
  // globals, so it has no place on a public deployment — but keeping it means the
  // code generator can be re-verified after any change without rewriting tests.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const project = buildFixture();
  const compiled = compileProject(project);

  const report = compiled.commands.map((command) => {
    const check = syntaxCheck(command.code ?? "");
    return {
      name: command.name,
      isDispatcher: Boolean(command.isDispatcher),
      usesAnswerField: Boolean(command.answer),
      keyboardField: command.keyboard || null,
      aliases: command.aliases,
      needReply: command.need_reply,
      codeLength: (command.code ?? "").length,
      syntax: check.ok ? "valid" : `INVALID: ${check.error}`,
    };
  });

  const flowCode = compiled.commands.find((c) => c.name === "/signup")?.code ?? "";
  const richCode = compiled.commands.find((c) => c.name === "/menu")?.code ?? "";
  const dispatcherCode = compiled.commands.find((c) => c.isDispatcher)?.code ?? "";
  const callbackCode = compiled.commands.find((c) => c.name === "confirm")?.code ?? "";

  let checks: CheckResult[] = [];
  const runnerErrors: string[] = [];

  const suites: [string, () => Promise<CheckResult[]>][] = [
    ["flow", () => testFlow(flowCode)],
    ["rich", () => testRich(richCode)],
    ["dispatcher", () => testDispatcher(dispatcherCode)],
    ["callback", () => testCallback(callbackCode)],
  ];

  for (const [label, suite] of suites) {
    try {
      checks = checks.concat(await suite());
    } catch (error) {
      runnerErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const failed = checks.filter((check) => !check.passed);

  return NextResponse.json({
    stats: compiled.stats,
    hasErrors: compiled.hasErrors,
    diagnostics: compiled.diagnostics.map(
      (d) => `${d.level.toUpperCase()}: ${d.nodeLabel ?? "-"} — ${d.message}`,
    ),
    commands: report,
    allSyntaxValid: report.every((item) => item.syntax === "valid"),
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
