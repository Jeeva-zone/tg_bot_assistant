# TeleBot Builder

A no-code visual builder for Telegram bots that compiles your design into
[TeleBotHost](https://telebothost.com) (TBL) commands and deploys them in one click.

Design commands, keyboards and multi-step forms in the browser — the app generates
real TBL JavaScript, uploads it through the TeleBotHost Developer API, and starts
your bot.

---

## What it does

| Area | Capability |
|---|---|
| **Credentials** | Telegram BotFather token + TeleBotHost API key, verified against both live APIs, then encrypted in the browser |
| **Command builder** | Form-based editing of triggers, responses, keyboards and multi-step forms |
| **Workflow canvas** | Drag-and-drop node graph (`@xyflow/react`) with six script-block types, wired together and compiled to TBL |
| **Triggers** | Slash commands, exact keywords, regex patterns, inline-button callbacks, inline queries, wildcard fallback |
| **Responses** | Markdown / MarkdownV2 / HTML text, photo · document · video · audio attachments |
| **Keyboards** | Persistent reply keyboards and inline keyboards with callback, URL or web-app buttons |
| **Multi-step forms** | Sequential prompts with per-field validation, persisted in TeleBotHost's built-in `db` |
| **API blocks** | External HTTP GET/POST/PUT/PATCH/DELETE with env-backed secret headers and response binding |
| **Deployment** | Register or reuse a bot, upload commands with rate-limit-aware pacing, toggle it running, live progress log |
| **Analytics** | Online/offline status, user statistics, and a polled execution log with error stacks |

There are two ways to author a bot, and they share the same compiler targets and deploy engine:

- **Bot Builder** (`/builder`) — a form per command. Better for precise, list-oriented editing.
- **Workflow Canvas** (`/workflow`) — a node graph. Better for branching logic and seeing the flow.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

Then open **Credentials** and paste:

1. A bot token from [@BotFather](https://t.me/BotFather) (`/newbot`)
2. A **secret** API key (`sk_…`) from the [TeleBotHost console](https://console.telebothost.com/)

Both are validated live. A read-only `pub_…` key is rejected up front, because it
cannot create or modify bots.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |

---

## How it works

```
Browser tab                                   Netlify function          TeleBotHost
─────────────                                 ────────────────          ───────────
credentials ──AES-GCM──> localStorage
      │
      └─ decrypt in memory ──x-tbh-key──>  /api/tbh/*  ──Bearer sk_──>  api.telebothost.com
```

### Credentials never leave the browser unencrypted

- **AES-GCM 256**, authenticated — tampering is detected rather than silently accepted.
- The key is **non-extractable** and stored in **IndexedDB**, which is the only
  browser store that can hold a `CryptoKey`. A copy of `localStorage` alone is useless.
- The proxy routes are **stateless**. The key arrives per-request in the `x-tbh-key`
  header and is never persisted or logged server-side, so there is no server-side
  credential store to breach.
- Plaintext exists only in memory for the lifetime of the tab.

**Known limitation:** like any browser-only vault, this cannot defend against script
injected into the same origin while the app is running (XSS). No purely client-side
scheme can. Keep the app on a trusted device.

### Deploys run in the browser, not in a function

Deploying means one HTTP request per command. Netlify Functions are capped at roughly
10–26 seconds, so a 40-command bot would be killed mid-deploy and left half-configured.
The engine therefore drives the sequence from the client: every request stays short,
function timeouts can't truncate the run, and progress streams into the UI in real time.

TeleBotHost's **FREE tier allows 15 requests per minute**, so the engine reads the
documented `X-RateLimit-*-Minute` headers and parks the queue before it can trip the
strike system. A 429 is honoured via `retry_after` and retried once.

---

## The compiler

`src/lib/compiler.ts` lowers the builder state into TeleBotHost payloads. Four rules
drive its design — each one is a real constraint of the platform, not a preference:

**1. Regex cannot be a command name.**
TBL routing is exact-name → alias → dynamic handler → `*` fallback. There is no regex
matching in the router. Every regex rule is therefore consolidated into a **single `*`
dispatcher command** whose JavaScript tests each pattern in order, first match wins.

**2. Only one `*` command exists per bot.**
So the wildcard node and every regex rule have to share it. Extra wildcards are dropped
with a warning.

**3. `need_reply` re-sends the Answer field on every step.**
A multi-step form would spam the user with its intro text each time. Flow commands
therefore leave `answer` empty and deliver everything from generated `code`.

**4. A reply keyboard needs a message to attach to.**
A keyboard-only command is a build error. TeleBotHost's plain `keyboard` string also
cannot carry `resize_keyboard`, `one_time_keyboard` or a placeholder — so customising
any of those switches the command to sending raw `reply_markup` from code instead.

The builder surfaces all of this as **build errors and warnings** in the Builder tab,
and the Deploy page refuses to run while any error is outstanding.

### Multi-step forms

A flow compiles to a state machine stored in `db.user` (or `db.bot`) under a
per-command key, holding `{ step, data }`:

```js
let __st = await db.user.get("flow_cmd_abc123", { step: 0, data: {} })
if (__st.step > 0) {
  const __i = __st.step - 1
  const __val = String(message || "").trim()
  // ... validate, re-ask on failure, otherwise store __st.data[__KEYS[__i]]
}
```

`step` is the index of the *next* question, which makes "is this message an answer?"
simply `step > 0`.

---

## The workflow canvas

`compileCanvasToTeleBotHostScript(nodes, edges)` in `src/lib/workflow-compiler.ts` lowers
a node graph into TeleBotHost commands.

### The core problem

TBL has no persistent graph runtime. It is a **command** platform: a message arrives, TBL
matches exactly one command, runs that script once, and sleeps. A node graph therefore
cannot be interpreted — it has to be **flattened** into self-contained command scripts.

So the compiler:

1. Treats every **Trigger** node as the root of one command.
2. Walks downstream, emitting statements in order.
3. Inlines **Condition** nodes as real `if/else` blocks, recursively.
4. Turns **State** nodes into stage boundaries — see below.
5. Folds every **regex** and **wildcard** trigger into the single `*` dispatcher command,
   because TBL routes on exact names and permits one wildcard.

### Six block types

| Block | Compiles to |
|---|---|
| **Trigger** | The command `name` (and `aliases`, `case_insensitive`, `allow_only_group`) |
| **Message response** | `Api.sendMessage` / `Api.sendPhoto` / … with `{{variable}}` interpolation |
| **Keyboard** | `Api.sendMessage` with `reply_markup` (inline or reply) |
| **API fetch** | `fetch` wrapped in try/catch, response bound to a variable, optional halt-on-error |
| **Condition / branch** | A real `if (…) { … } else { … }` block |
| **State / form input** | A stage boundary backed by a `db` state machine |

### Why State blocks create stages

Capturing input requires `need_reply`, which **re-runs the entire command** on the user's
next message. Without bookkeeping the flow would replay from the top and re-send every
earlier message. The compiler therefore emits a step machine:

```js
let __wf = await db.user.get("__wf_doc_start", { step: 0, vars: {} })

switch (__wf.step) {
  case 0: {
    // …stage 0 statements…
    __wf.step = 1
    await db.user.set("__wf_doc_start", __wf)
    Bot.sendMessage("What's your email?")
    return
  }
  case 1: {
    const __val = String(message || "").trim()
    let __bad = false
    if (__val.length === 0) __bad = true
    if (!__bad && __val.length > 0 && !(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(__val))) __bad = true
    if (__bad) {
      Bot.sendMessage("That isn't a valid email.")
      Bot.sendMessage("What's your email?")
      return
    }
    __wf.vars.user_email = __val
    // …stage 1 statements, e.g. "Thanks! Saved " + String(__wf.vars.user_email ?? "")…
    await db.user.set("__wf_doc_start", null)
    return
  }
  default:
    await db.user.set("__wf_doc_start", null)
    return
}
```

The step counter and the captured answers share **one** record, so they can never end up in
different `db` collections. A graph with no State blocks emits straight-line code instead —
no step machine, which is both simpler and faster.

### Variable scoping — the subtle part

- **State** variables are persisted in the record and **survive a pause**.
- **API** and **Message** variables are ordinary `let` bindings that die with the execution.

Referencing a local variable *after* a pause therefore reads `null` — silently, with valid
JavaScript. The compiler detects this and warns:

> *"{{apiResponse.status}}" was set by an API or Message block before a form-input step.
> Those values do not survive the pause, so this will read null.*

### Validation

The canvas validates continuously and surfaces problems in three places: a badge on the
offending node, field-level messages in the inspector, and a Validation tab listing
everything. Errors block deployment; warnings do not.

Checks include: cycles, orphaned blocks, triggers with no actions, duplicate trigger names,
multiple wildcards, unconnected condition branches, invalid regex, malformed JSON bodies,
missing required fields, callback data over Telegram's 64-byte limit, and attempts to shadow
a TBL global (`message`, `user`, `db`, …) with a variable name.

### Deliberate constraints

- **Form input cannot live inside a condition branch.** The branch would be re-evaluated on
  the next message and could take a different path. Reported as an error.
- **Form input cannot live in the `*` dispatcher.** The shared fallback cannot track which
  trigger paused. Reported as an error.
- **Each output handle takes one connection.** Connecting a second replaces the first rather
  than silently creating a second, ignored path.

---

## Project structure

```
src/
├── app/
│   ├── page.tsx                  Dashboard
│   ├── setup/                    Credential onboarding
│   ├── builder/                  Form-based command builder
│   ├── workflow/                 Node-graph workflow canvas
│   ├── deploy/                   Deployment engine
│   ├── analytics/                Status, stats, logs
│   └── api/
│       ├── telegram/validate/    getMe proxy
│       ├── tbh/status/           Public health probe
│       ├── tbh/validate/         Key validation
│       ├── tbh/bots/             List, create
│       ├── tbh/bots/[botId]/     Get, update (start/stop), delete
│       ├── .../commands/         List, create, delete
│       ├── .../commands/[id]/    Get, update, delete
│       ├── .../logs/             Read, clear
│       ├── .../analytics/        Usage stats
│       ├── selftest/             Dev-only compiler tests (404 in production)
│       └── selftest/workflow/    Dev-only graph-compiler tests
├── components/
│   ├── ui/                       shadcn/ui primitives
│   ├── layout/                   App shell, page header
│   ├── builder/                  Trigger/response/keyboard/flow panels, code preview
│   └── workflow/
│       ├── block-palette.tsx     Draggable script-block library
│       ├── workflow-canvas.tsx   React Flow canvas
│       ├── code-output-panel.tsx Generated TBL viewer
│       ├── deploy-dialog.tsx     Deploy from the canvas
│       ├── workflow-context.tsx  Validation-issues context
│       ├── nodes/                Custom node components + shared shell
│       └── inspector/            Parameter editors per block type
├── lib/
│   ├── crypto.ts                 AES-GCM + PBKDF2 via Web Crypto
│   ├── keystore.ts               IndexedDB CryptoKey storage
│   ├── vault.ts                  Encrypted credentials + local persistence
│   ├── compiler.ts               Command-list builder → TBL
│   ├── workflow-compiler.ts      Node graph → TBL
│   ├── workflow-blocks.ts        Block catalog, defaults, field validation
│   ├── workflow-labels.ts        Shared enum labels
│   ├── deploy-engine.ts          Rate-limit-aware deployment orchestration
│   ├── tbh-client.ts             Server-side TeleBotHost client
│   ├── telegram-client.ts        Server-side getMe
│   └── client-api.ts             Browser → proxy routes
├── store/
│   ├── useCredentials.ts         In-memory credentials + vault metadata
│   ├── useBuilder.ts             Command-list project state
│   └── useWorkflow.ts            Workflow graph state
└── types/
    ├── telegram.ts               Telegram Bot API subset
    ├── telebothost.ts            TeleBotHost API (from the live OpenAPI doc)
    ├── builder.ts                Command-list builder model
    └── workflow.ts               Workflow block & graph model
```

---

## Verification

Both compilers are verified in two layers, because they catch different classes of bug.

```bash
npm run dev

# Command-list compiler — 14 behavioural checks
curl -s http://localhost:3000/api/selftest | jq .behaviour

# Workflow graph compiler — 19 behavioural checks
curl -s http://localhost:3000/api/selftest/workflow | jq .behaviour
```

Both endpoints are **dev-only** (404 in production). Each compiles a fixture covering every
block type, then:

1. **Syntax-checks** every generated script.
2. **Executes** it against mocked `Bot`, `Api`, `db`, `user`, `chat`, `message`, `fetch` and
   `process` globals, asserting on real behaviour.

The workflow suite asserts, among other things, that a condition takes the correct branch
(including case-insensitively), that a state machine asks, rejects invalid input **without
advancing**, resumes with the captured value interpolated, and clears its record; that an API
failure halts the flow; that the dispatcher matches a regex and falls through to the wildcard;
and that cycles, orphans, bare triggers and TBL-global shadowing are all rejected.

Layer 2 is what matters. Real bugs this caught during development:

| Bug | Why the syntax check missed it |
|---|---|
| The chain walk started *at* the trigger, so every command compiled to empty code | Valid (empty) JavaScript |
| `{{user.first_name}}` and `{{apiResponse.status}}` were emitted as literal text | Valid string literals |
| A validator referenced `val` while the state machine declared `__val` | Parses fine; throws only at runtime |
| A key array was emitted as a *string*, so `__KEYS[i]` indexed characters | Valid syntax |

None of these are visible by reading the output; all of them produce a bot that silently
misbehaves. Hence executing the generated code rather than trusting it.

---

## Deployment (Netlify)

`netlify.toml` is already configured with the Next.js Runtime plugin, a pinned Node
version, and security headers (`no-store` on `/api/*`, a restrictive CSP, no
framing). To ship:

1. Netlify → **Add new site** → **Import an existing project** → pick the repo
2. Accept the detected build settings (`npm run build`, publish `.next`)
3. Deploy

**No environment variables are required.** Credentials are supplied by each user at
runtime and encrypted in their browser, so there is no server-side secret to configure.

---

## API reference

Built against the TeleBotHost Developer API **v1.0.1**
(`https://api.telebothost.com/api/v1/docs/openapi.json`). Endpoints used:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/status` | Public health probe |
| `GET` | `/bot` | List bots (also validates a key) |
| `POST` | `/bot` | Register a bot |
| `PATCH` | `/bot/{botid}` | Update / **start and stop** (`status: 1 \| 0`) |
| `DELETE` | `/bot/{botid}` | Delete |
| `GET` `POST` `DELETE` | `/bot/{botid}/commands` | List / create / clear all |
| `GET` `PATCH` `DELETE` | `/bot/{botid}/commands/{commandid}` | Read / update / delete |
| `GET` `DELETE` | `/bot/{botid}/logs` | Execution log |
| `GET` | `/bot/{botid}/analytics` | Usage statistics |

Capacity limits enforced by the UI: 1,000 commands per bot, 100,000 characters per
script, 10,000 per answer.

---

## Notes and limits

- **Multi-step forms keep their `need_reply` session open after completion**, so the
  next plain message restarts the form. Give users a `/start` or cancel command, and
  say so in the completion message — the builder warns about this on every flow.
- **Analytics are periodic**, not real time. The UI shows TeleBotHost's `calculated_at`
  rather than implying the numbers are live.
- **Telegram bots are long-lived processes.** This app builds and deploys them to
  TeleBotHost, which is the runtime. It is not itself a bot host.
- Dark mode is supported via the `.dark` class on `<html>`.
