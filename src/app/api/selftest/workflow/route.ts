import { NextResponse } from "next/server";
import { compileCanvasToTeleBotHostScript } from "@/lib/workflow-compiler";
import { HANDLE, createWorkflowId, type WorkflowEdge, type WorkflowNode } from "@/types/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dev-only self-test for the workflow compiler (404 in production).
 *
 * Same two-layer approach as the command-list compiler test: syntax-check the
 * generated TBL, then actually **execute** it against mocked globals and assert on
 * behaviour. Execution is the layer that matters — a syntax check cannot tell you
 * that a condition took the wrong branch or that a state machine lost its place.
 */

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  sent: string[];
  media: string[];
  callbacks: number;
  store: Map<string, unknown>;
  fetches: string[];
  run: (code: string, message: string) => Promise<void>;
}

function createHarness(fetchImpl?: (url: string, init?: unknown) => Promise<unknown>): Harness {
  const sent: string[] = [];
  const media: string[] = [];
  const fetches: string[] = [];
  const store = new Map<string, unknown>();
  let callbacks = 0;

  const scope = {
    get: async (key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback),
    set: async (key: string, value: unknown) => {
      // Mirrors TeleBotHost: null/undefined/"" deletes the key.
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

  const fetchStub = async (url: unknown, init?: unknown) => {
    fetches.push(String(url));
    if (fetchImpl) return fetchImpl(String(url), init);
    return {
      ok: true,
      json: async () => ({ status: "ok", value: 42 }),
    };
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
      "fetch",
      "process",
      `return (async () => {\n${code}\n})()`,
    );
    await factory(
      Bot,
      Api,
      { user: scope, bot: scope, global: scope },
      { id: 1, first_name: "Ada" },
      { id: 1, type: "private" },
      message,
      "",
      fetchStub,
      { env: { MY_SECRET: "from-env" } },
    );
  }

  return {
    sent,
    media,
    store,
    fetches,
    get callbacks() {
      return callbacks;
    },
    run,
  };
}

function syntaxCheck(code: string): { ok: boolean; error?: string } {
  try {
    new Function(`return (async () => {\n${code}\n})()`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "parse error" };
  }
}

// ---------------------------------------------------------------------------
// Fixture graph
// ---------------------------------------------------------------------------

type NodeSpec = {
  id: string;
  type: WorkflowNode["type"];
  data: WorkflowNode["data"];
  position: { x: number; y: number };
};

function node(id: string, type: WorkflowNode["type"], data: WorkflowNode["data"]): NodeSpec {
  return { id, type, data, position: { x: 0, y: 0 } };
}

function edge(source: string, target: string, sourceHandle: string = HANDLE.OUTPUT): WorkflowEdge {
  return {
    id: createWorkflowId("e"),
    source,
    target,
    sourceHandle,
    targetHandle: HANDLE.INPUT,
  };
}

function buildFixture(): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const specs: NodeSpec[] = [
    // -- Linear chain ------------------------------------------------------
    node("t_start", "trigger", {
      kind: "trigger",
      label: "Start",
      triggerKind: "command",
      value: "/start",
      caseInsensitive: false,
      aliases: ["Start"],
      groupOnly: false,
    }),
    node("m_welcome", "message", {
      kind: "message",
      label: "Welcome",
      text: "Hi {{user.first_name}}, welcome!",
      parseMode: "Markdown",
      media: [],
      captureMessageId: "",
    }),
    node("k_menu", "keyboard", {
      kind: "keyboard",
      label: "Menu",
      keyboardType: "inline",
      text: "Pick one",
      parseMode: "Markdown",
      rows: [
        [
          { id: "b1", text: "Pricing", action: "callback", value: "price" },
          { id: "b2", text: "Site", action: "url", value: "https://example.com" },
        ],
      ],
      resize: true,
      oneTime: false,
      placeholder: "",
    }),

    // -- Condition branches ------------------------------------------------
    node("t_price", "trigger", {
      kind: "trigger",
      label: "Price callback",
      triggerKind: "callback",
      value: "price",
      caseInsensitive: false,
      aliases: [],
      groupOnly: false,
    }),
    node("c_price", "condition", {
      kind: "condition",
      label: "Mentions price",
      subject: "message",
      variable: "",
      operator: "contains",
      compareValue: "price",
      caseInsensitive: true,
    }),
    node("m_yes", "message", {
      kind: "message",
      label: "Price info",
      text: "Our plans start free.",
      parseMode: "Markdown",
      media: [],
      captureMessageId: "",
    }),
    node("m_no", "message", {
      kind: "message",
      label: "No price",
      text: "Let me look into that.",
      parseMode: "Markdown",
      media: [],
      captureMessageId: "",
    }),

    // -- State machine -----------------------------------------------------
    node("t_signup", "trigger", {
      kind: "trigger",
      label: "Signup",
      triggerKind: "command",
      value: "/signup",
      caseInsensitive: false,
      aliases: [],
      groupOnly: false,
    }),
    node("s_email", "state", {
      kind: "state",
      label: "Email",
      variable: "user_email",
      prompt: "What's your email?",
      validator: "email",
      required: true,
      errorMessage: "That isn't a valid email.",
      scope: "user",
      confirmMessage: "",
    }),
    node("m_thanks", "message", {
      kind: "message",
      label: "Thanks",
      text: "Thanks! Saved {{user_email}}.",
      parseMode: "Markdown",
      media: [],
      captureMessageId: "",
    }),

    // -- API block ---------------------------------------------------------
    node("t_api", "trigger", {
      kind: "trigger",
      label: "Status",
      triggerKind: "command",
      value: "/status",
      caseInsensitive: false,
      aliases: [],
      groupOnly: false,
    }),
    node("a_status", "api", {
      kind: "api",
      label: "Fetch status",
      method: "GET",
      url: "https://api.example.com/status",
      headers: [{ id: "h1", name: "X-Api-Key", value: "", secret: true }],
      body: "",
      bindTo: "statusResponse",
      timeoutMs: 10_000,
      errorMessage: "Status lookup failed.",
      haltOnError: true,
    }),
    node("m_status", "message", {
      kind: "message",
      label: "Report",
      text: "Status is {{statusResponse.status}}.",
      parseMode: "Markdown",
      media: [],
      captureMessageId: "",
    }),

    // -- Regex + wildcard -> shared dispatcher -----------------------------
    node("t_regex", "trigger", {
      kind: "trigger",
      label: "Order pattern",
      triggerKind: "regex",
      value: "^order\\s+(\\d+)$",
      caseInsensitive: true,
      aliases: [],
      groupOnly: false,
    }),
    node("m_order", "message", {
      kind: "message",
      label: "Order lookup",
      text: "Looking up your order…",
      parseMode: "Markdown",
      media: [],
      captureMessageId: "",
    }),
    node("t_wild", "trigger", {
      kind: "trigger",
      label: "Fallback",
      triggerKind: "wildcard",
      value: "*",
      caseInsensitive: false,
      aliases: [],
      groupOnly: false,
    }),
    node("m_fallback", "message", {
      kind: "message",
      label: "Fallback reply",
      text: "I didn't catch that.",
      parseMode: "Markdown",
      media: [],
      captureMessageId: "",
    }),
  ];

  const edges: WorkflowEdge[] = [
    edge("t_start", "m_welcome"),
    edge("m_welcome", "k_menu"),
    edge("t_price", "c_price"),
    edge("c_price", "m_yes", HANDLE.TRUE),
    edge("c_price", "m_no", HANDLE.FALSE),
    edge("t_signup", "s_email"),
    edge("s_email", "m_thanks"),
    edge("t_api", "a_status"),
    edge("a_status", "m_status"),
    edge("t_regex", "m_order"),
    edge("t_wild", "m_fallback"),
  ];

  return { nodes: specs as WorkflowNode[], edges };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

function check(name: string, passed: boolean, detail: string): Check {
  return { name, passed, detail };
}

async function testLinear(
  code: string,
  keyboardCode: string,
): Promise<Check[]> {
  const results: Check[] = [];

  const h = createHarness();
  await h.run(code, "");
  results.push(
    check(
      "linear: message text with {{user.first_name}} interpolated",
      h.sent.some((line) => line === "Hi Ada, welcome!"),
      `sent=${JSON.stringify(h.sent)}`,
    ),
  );

  const k = createHarness();
  await k.run(keyboardCode, "");
  const payload = k.sent.join(" ");
  results.push(
    check(
      "keyboard: inline keyboard message sent",
      payload.includes("Pick one"),
      `sent=${JSON.stringify(k.sent)}`,
    ),
  );

  return results;
}

async function testCondition(code: string): Promise<Check[]> {
  const results: Check[] = [];

  const hit = createHarness();
  await hit.run(code, "how much is the price?");
  results.push(
    check(
      "condition: true branch runs when the message matches",
      hit.sent.some((line) => line.includes("plans start free")) &&
        !hit.sent.some((line) => line.includes("look into that")),
      `sent=${JSON.stringify(hit.sent)}`,
    ),
  );

  const miss = createHarness();
  await miss.run(code, "hello there");
  results.push(
    check(
      "condition: false branch runs otherwise",
      miss.sent.some((line) => line.includes("look into that")) &&
        !miss.sent.some((line) => line.includes("plans start free")),
      `sent=${JSON.stringify(miss.sent)}`,
    ),
  );

  const upper = createHarness();
  await upper.run(code, "PRICE please");
  results.push(
    check(
      "condition: case-insensitive comparison honoured",
      upper.sent.some((line) => line.includes("plans start free")),
      `sent=${JSON.stringify(upper.sent)}`,
    ),
  );

  return results;
}

async function testStateMachine(code: string, needReply: boolean): Promise<Check[]> {
  const results: Check[] = [];

  results.push(
    check(
      "state: command is marked need_reply",
      needReply === true,
      `need_reply=${needReply}`,
    ),
  );

  const h = createHarness();

  // --- Run 1: the trigger. Should ask, store step 1, and stop. ---
  await h.run(code, "");
  results.push(
    check(
      "state: first run asks the question",
      h.sent.length === 1 && h.sent[0] === "What's your email?",
      `sent=${JSON.stringify(h.sent)}`,
    ),
  );

  const persisted = [...h.store.values()][0] as { step?: number } | undefined;
  results.push(
    check(
      "state: step advanced to 1 and persisted",
      persisted?.step === 1,
      `store=${JSON.stringify([...h.store.entries()])}`,
    ),
  );

  // --- Run 2: invalid answer. Should re-ask and NOT advance. ---
  h.sent.length = 0;
  await h.run(code, "not-an-email");
  const afterBad = [...h.store.values()][0] as { step?: number } | undefined;
  results.push(
    check(
      "state: invalid input re-asks without advancing",
      h.sent.includes("That isn't a valid email.") &&
        h.sent.includes("What's your email?") &&
        afterBad?.step === 1,
      `sent=${JSON.stringify(h.sent)} step=${afterBad?.step}`,
    ),
  );

  // --- Run 3: valid answer. Should store it, run the next stage, and clear. ---
  h.sent.length = 0;
  await h.run(code, "ada@example.com");
  results.push(
    check(
      "state: valid input resumes and interpolates the captured value",
      h.sent.some((line) => line.includes("Saved ada@example.com")),
      `sent=${JSON.stringify(h.sent)}`,
    ),
  );

  results.push(
    check(
      "state: persisted record cleared once the flow completes",
      h.store.size === 0,
      `store=${JSON.stringify([...h.store.entries()])}`,
    ),
  );

  return results;
}

async function testApi(code: string): Promise<Check[]> {
  const results: Check[] = [];

  const ok = createHarness();
  await ok.run(code, "");
  results.push(
    check(
      "api: request issued and response bound to {{statusResponse.status}}",
      ok.fetches.includes("https://api.example.com/status") &&
        ok.sent.some((line) => line.includes("Status is ok")),
      `fetches=${JSON.stringify(ok.fetches)} sent=${JSON.stringify(ok.sent)}`,
    ),
  );

  const failing = createHarness(async () => {
    throw new Error("network down");
  });
  await failing.run(code, "");
  results.push(
    check(
      "api: failure halts the flow and reports the error",
      failing.sent.some((line) => line.includes("Status lookup failed")) &&
        !failing.sent.some((line) => line.includes("Status is")),
      `sent=${JSON.stringify(failing.sent)}`,
    ),
  );

  return results;
}

async function testDispatcher(code: string): Promise<Check[]> {
  const results: Check[] = [];

  const match = createHarness();
  await match.run(code, "order 42");
  results.push(
    check(
      "dispatcher: regex rule matches",
      match.sent.some((line) => line.includes("Looking up your order")),
      `sent=${JSON.stringify(match.sent)}`,
    ),
  );

  const fallthrough = createHarness();
  await fallthrough.run(code, "nonsense");
  results.push(
    check(
      "dispatcher: unmatched text falls through to the wildcard",
      fallthrough.sent.some((line) => line.includes("didn't catch that")),
      `sent=${JSON.stringify(fallthrough.sent)}`,
    ),
  );

  return results;
}

async function testCycleAndOrphan(): Promise<Check[]> {
  const results: Check[] = [];

  // -- Cycle --
  const cyclic = {
    nodes: [
      node("a", "trigger", {
        kind: "trigger",
        label: "A",
        triggerKind: "command",
        value: "/a",
        caseInsensitive: false,
        aliases: [],
        groupOnly: false,
      }),
      node("b", "message", {
        kind: "message",
        label: "B",
        text: "b",
        parseMode: "Markdown",
        media: [],
        captureMessageId: "",
      }),
      node("c", "message", {
        kind: "message",
        label: "C",
        text: "c",
        parseMode: "Markdown",
        media: [],
        captureMessageId: "",
      }),
    ] as WorkflowNode[],
    edges: [edge("a", "b"), edge("b", "c"), edge("c", "b")],
  };

  const cycleResult = compileCanvasToTeleBotHostScript(cyclic.nodes, cyclic.edges);
  results.push(
    check(
      "validation: cycle is detected as an error",
      cycleResult.hasErrors &&
        cycleResult.issues.some((issue) => issue.message.toLowerCase().includes("cycle")),
      `issues=${JSON.stringify(cycleResult.issues.map((i) => i.message))}`,
    ),
  );

  // -- Orphan --
  const orphaned = {
    nodes: [
      node("a", "trigger", {
        kind: "trigger",
        label: "A",
        triggerKind: "command",
        value: "/a",
        caseInsensitive: false,
        aliases: [],
        groupOnly: false,
      }),
      node("b", "message", {
        kind: "message",
        label: "B",
        text: "b",
        parseMode: "Markdown",
        media: [],
        captureMessageId: "",
      }),
      node("floating", "message", {
        kind: "message",
        label: "Floating",
        text: "unreachable",
        parseMode: "Markdown",
        media: [],
        captureMessageId: "",
      }),
    ] as WorkflowNode[],
    edges: [edge("a", "b")],
  };

  const orphanResult = compileCanvasToTeleBotHostScript(orphaned.nodes, orphaned.edges);
  results.push(
    check(
      "validation: unconnected block is reported",
      orphanResult.issues.some((issue) => issue.message.includes("Floating")),
      `issues=${JSON.stringify(orphanResult.issues.map((i) => i.message))}`,
    ),
  );

  // -- Trigger with nothing attached --
  const bare = {
    nodes: [
      node("lonely", "trigger", {
        kind: "trigger",
        label: "Lonely",
        triggerKind: "command",
        value: "/lonely",
        caseInsensitive: false,
        aliases: [],
        groupOnly: false,
      }),
    ] as WorkflowNode[],
    edges: [],
  };

  const bareResult = compileCanvasToTeleBotHostScript(bare.nodes, bare.edges);
  results.push(
    check(
      "validation: trigger with no actions is an error",
      bareResult.hasErrors &&
        bareResult.issues.some((issue) => issue.message.includes("nothing connected")),
      `issues=${JSON.stringify(bareResult.issues.map((i) => i.message))}`,
    ),
  );

  // -- Reserved variable name --
  const reserved = {
    nodes: [
      node("t", "trigger", {
        kind: "trigger",
        label: "T",
        triggerKind: "command",
        value: "/t",
        caseInsensitive: false,
        aliases: [],
        groupOnly: false,
      }),
      node("s", "state", {
        kind: "state",
        label: "Shadow",
        variable: "message",
        prompt: "say something",
        validator: "none",
        required: true,
        errorMessage: "",
        scope: "user",
        confirmMessage: "",
      }),
    ] as WorkflowNode[],
    edges: [edge("t", "s")],
  };

  const reservedResult = compileCanvasToTeleBotHostScript(reserved.nodes, reserved.edges);
  results.push(
    check(
      "validation: shadowing a TBL global is rejected",
      reservedResult.hasErrors &&
        reservedResult.issues.some((issue) => issue.message.includes("TBL global")),
      `issues=${JSON.stringify(reservedResult.issues.map((i) => i.message))}`,
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

  const { nodes, edges } = buildFixture();
  const compiled = compileCanvasToTeleBotHostScript(nodes, edges, { documentId: "selftest" });

  const byName = new Map(compiled.commands.map((command) => [command.name, command]));
  const dispatcher = compiled.commands.find((command) => command.name === "*");

  const syntax = compiled.commands.map((command) => ({
    name: command.name,
    length: command.code.length,
    needReply: command.need_reply,
    syntax: syntaxCheck(command.code).ok ? "valid" : `INVALID: ${syntaxCheck(command.code).error}`,
  }));

  let checks: Check[] = [];
  const runnerErrors: string[] = [];

  const suites: [string, () => Promise<Check[]>][] = [
    [
      "linear",
      () =>
        testLinear(
          byName.get("/start")?.code ?? "",
          byName.get("/start")?.code ?? "",
        ),
    ],
    ["condition", () => testCondition(byName.get("price")?.code ?? "")],
    [
      "state",
      () =>
        testStateMachine(
          byName.get("/signup")?.code ?? "",
          byName.get("/signup")?.need_reply ?? false,
        ),
    ],
    ["api", () => testApi(byName.get("/status")?.code ?? "")],
    ["dispatcher", () => testDispatcher(dispatcher?.code ?? "")],
    ["validation", () => testCycleAndOrphan()],
  ];

  for (const [label, suite] of suites) {
    try {
      checks = checks.concat(await suite());
    } catch (error) {
      runnerErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const failed = checks.filter((item) => !item.passed);

  return NextResponse.json({
    stats: compiled.stats,
    hasErrors: compiled.hasErrors,
    commandNames: compiled.commands.map((command) => command.name),
    syntax,
    diagnostics: compiled.issues.map(
      (issue) => `${issue.severity.toUpperCase()}: ${issue.message}`,
    ),
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
