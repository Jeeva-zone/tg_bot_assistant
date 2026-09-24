/**
 * Starter templates and suggestion chips.
 *
 * Two different jobs:
 *
 * - **Chips** are prompts. Clicking one sends a detailed brief to the model, because a
 *   bare label like "Add Lead Generation Form" gives it far too little to work with.
 * - **Templates** are hand-written, verified TBL that can be inserted and deployed
 *   with no model configured at all.
 *
 * Templates deliberately produce the same `CopilotArtifact` shape the model returns, so
 * they flow through the identical preview → diff → deploy path. One code path, two
 * sources of truth about *what* to build.
 */

import {
  BarChart3,
  Braces,
  CircleHelp,
  Gift,
  Hash,
  Megaphone,
  Route,
  type LucideIcon,
} from "lucide-react";
import type { CopilotArtifact } from "@/types/copilot";

// ---------------------------------------------------------------------------
// Suggestion chips (AI prompts)
// ---------------------------------------------------------------------------

export interface SuggestionChip {
  id: string;
  label: string;
  /** Shown as a tooltip. */
  description: string;
  icon: LucideIcon;
}

export const SUGGESTION_CHIPS: SuggestionChip[] = [
  {
    id: "lead-form",
    label: "Add Lead Generation Form",
    description: "Collect name, email and phone one step at a time",
    icon: Braces,
  },
  {
    id: "stripe-webhook",
    label: "Integrate Payment Webhook",
    description: "Call a payment API and reply with a checkout link",
    icon: Route,
  },
  {
    id: "broadcast",
    label: "Add Broadcast Command",
    description: "Owner-only mass message to everyone who has used the bot",
    icon: Megaphone,
  },
  {
    id: "help-menu",
    label: "Build a Help Menu",
    description: "List what the bot can do, with buttons to each command",
    icon: CircleHelp,
  },
  {
    id: "faq",
    label: "Add an FAQ",
    description: "Questions as buttons that reveal their answer in place",
    icon: Gift,
  },
  {
    id: "counter",
    label: "Add a Usage Counter",
    description: "Track how many times each user has run a command",
    icon: Hash,
  },
  {
    id: "welcome-gate",
    label: "Add a Welcome Gate",
    description: "Ask users to accept the rules before continuing",
    icon: BarChart3,
  },
];

// ---------------------------------------------------------------------------
// Starter templates (real TBL, no model required)
// ---------------------------------------------------------------------------

export interface StarterTemplate {
  id: string;
  title: string;
  summary: string;
  icon: LucideIcon;
  artifact: CopilotArtifact;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "welcome",
    title: "Welcome menu",
    summary: "Greets the user by name and offers an inline menu.",
    icon: Gift,
    artifact: {
      explanation:
        "A `/start` command that greets the user by first name and shows an inline menu. " +
        "The Help button routes back into the bot by sending `/help` as callback data.",
      command_name: "/start",
      aliases: ["Start"],
      parse_mode: "Markdown",
      tbl_code: [
        "// Greet the user and offer a menu.",
        "const name = user && user.first_name ? user.first_name : \"there\"",
        "",
        "await Api.sendMessage({",
        "  text: \"Hi \" + name + \"! 👋\\nWelcome — what would you like to do?\",",
        "  parse_mode: \"Markdown\",",
        "  reply_markup: {",
        "    inline_keyboard: [",
        "      [",
        "        { text: \"Help\", callback_data: \"/help\" },",
        "        { text: \"Website\", url: \"https://telebothost.com\" }",
        "      ]",
        "    ]",
        "  }",
        "})",
      ].join("\n"),
      notes: [
        "The Help button sends `/help` as callback data, which TBL routes back into the bot.",
        "Add a /help command for that button to do something.",
      ],
    },
  },

  {
    id: "help",
    title: "Help menu",
    summary: "Lists the bot's commands in a formatted message.",
    icon: CircleHelp,
    artifact: {
      explanation:
        "A `/help` command listing what the bot can do. Edit the `lines` array to match your own commands.",
      command_name: "/help",
      parse_mode: "Markdown",
      tbl_code: [
        "// Edit this list to match your own commands.",
        "const lines = [",
        "  \"/start — show the welcome menu\",",
        "  \"/help — list everything I can do\",",
        "  \"/count — your personal usage counter\"",
        "]",
        "",
        "await Api.sendMessage({",
        "  text: \"*Here's what I can do:*\\n\\n\" + lines.join(\"\\n\"),",
        "  parse_mode: \"Markdown\"",
        "})",
      ].join("\n"),
    },
  },

  {
    id: "counter",
    title: "Usage counter",
    summary: "Per-user counter stored in db.user.",
    icon: Hash,
    artifact: {
      explanation:
        "A `/count` command that increments a counter stored per user in `db.user`, so each " +
        "person sees their own total. It also keeps a bot-wide total in `db.bot`.",
      command_name: "/count",
      parse_mode: "Markdown",
      tbl_code: [
        "// Per-user count, plus a shared total for the whole bot.",
        "const mine = await db.user.get(\"count\", 0)",
        "const next = mine + 1",
        "await db.user.set(\"count\", next)",
        "",
        "const total = await db.bot.incr(\"total_commands\")",
        "",
        "await Api.sendMessage({",
        "  text:",
        "    \"You've used this *\" + next + \"* time\" + (next === 1 ? \"\" : \"s\") + \". 🎯\\n\" +",
        "    \"Everyone combined: *\" + total + \"*\",",
        "  parse_mode: \"Markdown\"",
        "})",
      ].join("\n"),
      notes: ["`db.user` is scoped to the current user and this bot, so counts stay personal."],
    },
  },

  {
    id: "lead",
    title: "Lead capture form",
    summary: "Three-step form with validation, saved per user.",
    icon: Braces,
    artifact: {
      explanation:
        "A `/lead` command that collects a name, email and phone number one at a time, " +
        "validating each answer before moving on, then saves everything to `db.user`. " +
        "It uses a step counter because TBL re-runs the whole script on every reply.",
      command_name: "/lead",
      need_reply: true,
      parse_mode: "Markdown",
      tbl_code: [
        "// Multi-step form. TBL re-runs this whole script on each reply, so the step",
        "// counter in db.user is what keeps us in the right place.",
        "const KEY = \"lead_step\"",
        "const step = await db.user.get(KEY, 0)",
        "",
        "if (step === 0) {",
        "  await db.user.set(KEY, 1)",
        "  return Bot.sendMessage(\"Let's get you set up. What's your *name*?\")",
        "}",
        "",
        "if (step === 1) {",
        "  const value = String(message || \"\").trim()",
        "  if (value.length < 2) {",
        "    return Bot.sendMessage(\"That looks a bit short — what's your name?\")",
        "  }",
        "  await db.user.set(\"lead_name\", value)",
        "  await db.user.set(KEY, 2)",
        "  return Bot.sendMessage(\"Thanks, \" + value + \"! What's your *email*?\")",
        "}",
        "",
        "if (step === 2) {",
        "  const value = String(message || \"\").trim()",
        "  if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(value)) {",
        "    return Bot.sendMessage(\"That doesn't look like an email. Try again?\")",
        "  }",
        "  await db.user.set(\"lead_email\", value)",
        "  await db.user.set(KEY, 3)",
        "  return Bot.sendMessage(\"Great. What's your *phone* number?\")",
        "}",
        "",
        "if (step === 3) {",
        "  const value = String(message || \"\").trim()",
        "  await db.user.set(\"lead_phone\", value)",
        "  await db.user.set(KEY, null)",
        "  return Bot.sendMessage(",
        "    \"All set! I've saved your details. 🎉\\n\\nSend /start to get back to the menu.\"",
        "  )",
        "}",
      ].join("\n"),
      notes: [
        "This command uses need_reply, so the next plain message continues the form.",
        "Tell users to send /start to escape if they change their mind mid-form.",
      ],
    },
  },

  {
    id: "broadcast",
    title: "Owner broadcast",
    summary: "Owner-only mass message, verified against OWNER_ID.",
    icon: Megaphone,
    artifact: {
      explanation:
        "A `/broadcast` command restricted to the bot owner. It reads the announcement from " +
        "the command arguments, checks the sender's id against an `OWNER_ID` environment " +
        "variable, then starts a mass-messaging job and reports how many users it targeted.",
      command_name: "/broadcast",
      parse_mode: "Markdown",
      tbl_code: [
        "// Owner-only broadcast. Set OWNER_ID in the dashboard environment variables.",
        "const OWNER_ID = process.env.OWNER_ID",
        "",
        "if (!OWNER_ID) {",
        "  return Bot.sendMessage(",
        "    \"Broadcast isn't configured yet — add OWNER_ID in the dashboard environment variables.\"",
        "  )",
        "}",
        "",
        "if (!user || String(user.id) !== String(OWNER_ID)) {",
        "  return Bot.sendMessage(\"Sorry, that command is owner-only.\")",
        "}",
        "",
        "const announcement = String(params || \"\").trim()",
        "if (!announcement) {",
        "  return Bot.sendMessage(\"Usage: /broadcast your message here\")",
        "}",
        "",
        "const job = await Bot.broadcast({",
        "  method: \"sendMessage\",",
        "  body: { text: announcement },",
        "  filters: { chatType: \"all\" }",
        "})",
        "",
        "Bot.sendMessage(",
        "  \"Broadcast started 🚀\\n\" +",
        "  \"Targets: \" + job.totalTargetChats + \"\\n\" +",
        "  \"Job id: \" + job.broadcastId",
        ")"
      ].join("\n"),
      notes: [
        "Add an environment variable named OWNER_ID with your numeric Telegram user id.",
        "Blocked users are excluded from broadcasts automatically.",
      ],
    },
  },

  {
    id: "fallback",
    title: "Wildcard fallback",
    summary: "The `*` command — catches anything unrecognised.",
    icon: Route,
    artifact: {
      explanation:
        "A `*` fallback command. TBL runs it whenever a message matches no other command, " +
        "so the bot never goes silent. Only one `*` is allowed per bot.",
      command_name: "*",
      parse_mode: "Markdown",
      tbl_code: [
        "// Catch-all. TBL runs this when nothing else matches.",
        "const text = String(message || \"\").trim()",
        "",
        "if (text.length > 0) {",
        "  await Api.sendMessage({",
        "    text:",
        "      \"I'm not sure what to do with \\\"\" + text.slice(0, 60) + \"\\\".\\n\\n\" +",
        "      \"Try /help to see what I can do.\",",
        "    parse_mode: \"Markdown\"",
        "  })",
        "} else {",
        "  await Api.sendMessage({",
        "    text: \"I can only read text messages at the moment. Try /help.\",",
        "    parse_mode: \"Markdown\"",
        "  })",
        "}",
      ].join("\n"),
      notes: ["There is exactly one `*` command per bot — deploying this replaces any existing one."],
    },
  },
];

/** Look up a template by id. */
export function findTemplate(id: string): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((template) => template.id === id);
}
