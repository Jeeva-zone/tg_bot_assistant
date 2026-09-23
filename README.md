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
| **Triggers** | Slash commands, exact keywords, regex patterns, inline-button callbacks, wildcard fallback |
| **Responses** | Markdown / MarkdownV2 / HTML text, photo · document · video · audio attachments |
| **Keyboards** | Persistent reply keyboards and inline keyboards with callback or URL buttons |
| **Multi-step forms** | Sequential prompts with per-field validation, persisted in TeleBotHost's built-in `db` |
| **Deployment** | Register or reuse a bot, upload commands with rate-limit-aware pacing, toggle it running, live progress log |
| **Analytics** | Online/offline status, user statistics, and a polled execution log with error stacks |

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

## Project structure

```
src/
├── app/
│   ├── page.tsx                  Dashboard
│   ├── setup/                    Credential onboarding
│   ├── builder/                  Visual builder
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
│       └── .../analytics/        Usage stats
├── components/
│   ├── ui/                       shadcn/ui primitives
│   ├── layout/                   App shell, page header
│   └── builder/                  Command list, trigger/response/keyboard/flow panels,
│                                 code preview, diagnostics
├── lib/
│   ├── crypto.ts                 AES-GCM + PBKDF2 via Web Crypto
│   ├── keystore.ts               IndexedDB CryptoKey storage
│   ├── vault.ts                  Encrypted credential vault
│   ├── compiler.ts               Builder state → TBL commands
│   ├── deploy-engine.ts          Rate-limit-aware deployment orchestration
│   ├── tbh-client.ts             Server-side TeleBotHost client
│   ├── telegram-client.ts        Server-side getMe
│   └── client-api.ts             Browser → proxy routes
├── store/
│   ├── useCredentials.ts         In-memory credentials + vault metadata
│   └── useBuilder.ts             Project state and all edit operations
└── types/
    ├── telegram.ts               Telegram Bot API subset
    ├── telebothost.ts            TeleBotHost API (from the live OpenAPI doc)
    └── builder.ts                Builder state model
```

---

## Verification

The compiler is verified in two layers, because they catch different classes of bug.

```bash
npm run dev
curl -s http://localhost:3000/api/selftest | jq
```

The self-test endpoint is **dev-only** (404 in production). It compiles a fixture
covering every node type, then:

1. **Syntax-checks** each generated script.
2. **Executes** each script against mocked `Bot`, `Api`, `db`, `user`, `chat` and
   `message` globals, asserting on real behaviour — that the form asks step 1, rejects
   an invalid email and re-asks, skips an optional field, clears state on completion,
   that the dispatcher matches a regex and falls through to the wildcard, and that a
   callback handler acknowledges its query.

Layer 2 matters: a syntax check happily accepts `val.length` even when the declared
variable is `__val`. Only running the code catches that.

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
