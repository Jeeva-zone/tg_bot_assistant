"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Eraser,
  KeyRound,
  Layers,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { CopilotCommandCard } from "@/components/copilot/command-card";
import { loadBotCommands } from "@/lib/copilot/deploy";
import { buildBotContext } from "@/lib/copilot/context";
import { buildChipPrompt } from "@/lib/copilot/system-prompt";
import { LLM_PROVIDERS } from "@/lib/copilot/providers";
import { STARTER_TEMPLATES, SUGGESTION_CHIPS } from "@/lib/copilot/templates";
import * as clientApi from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { toApiMessages, useCopilot } from "@/store/useCopilot";
import { useCredentials } from "@/store/useCredentials";
import type { CopilotArtifact, CopilotBotContext } from "@/types/copilot";
import type { BotListItem, TblCommand } from "@/types/telebothost";

/**
 * The AI Bot Engineer drawer.
 *
 * A right-hand panel that stays mounted across navigation, so the conversation
 * survives moving between the builder, the canvas and the analytics page. It is
 * context-aware: it reads the live command list from TeleBotHost, summarises it
 * inside a token budget, and feeds that to the model on every turn.
 *
 * The drawer degrades honestly. With no model configured it says so and offers the
 * hand-written starter templates instead of pretending to think; with no bot selected
 * it still works, and tells the model it has no context.
 */

const DRAWER_WIDTH = "26rem";

// ---------------------------------------------------------------------------
// Context bar
// ---------------------------------------------------------------------------

function ContextBar({
  bots,
  selectedBotId,
  onSelectBot,
  commands,
  loading,
  onRefresh,
}: {
  bots: BotListItem[];
  selectedBotId: number | null;
  onSelectBot: (id: number) => void;
  commands: TblCommand[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const selected = bots.find((bot) => bot.bot_id === selectedBotId) ?? null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
      <Bot className="size-3.5 shrink-0 text-muted-foreground" />

      {bots.length === 0 ? (
        <span className="text-[11px] text-muted-foreground">
          No bots on this account yet
        </span>
      ) : (
        <Select
          value={selectedBotId ? String(selectedBotId) : ""}
          onValueChange={(value) => onSelectBot(Number(value))}
        >
          <SelectTrigger className="h-7 flex-1 text-[11px]" aria-label="Active bot">
            <SelectValue placeholder="Select a bot" />
          </SelectTrigger>
          <SelectContent>
            {bots.map((bot) => (
              <SelectItem key={bot.bot_id} value={String(bot.bot_id)}>
                {bot.name}
                {bot.bot_username ? ` (@${bot.bot_username})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {selected && (
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            selected.status === 1 ? "bg-success" : "bg-muted-foreground/40",
          )}
          title={selected.status === 1 ? "Online" : "Offline"}
          aria-hidden
        />

      )}

      <Badge variant="muted" className="shrink-0 text-[9px]">
        {loading ? "…" : `${commands.length} cmds`}
      </Badge>

      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 shrink-0"
        onClick={onRefresh}
        disabled={loading || !selectedBotId}
        aria-label="Refresh bot context"
      >
        {loading ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <RefreshCw className="size-3" />
        )}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message rendering
// ---------------------------------------------------------------------------

function MessageBubble({
  message,
  existingCommand,
  apiKey,
  botId,
  canDeploy,
  deployBlockedReason,
}: {
  message: ReturnType<typeof useCopilot.getState>["messages"][number];
  existingCommand?: TblCommand;
  apiKey: string;
  botId: number | null;
  canDeploy: boolean;
  deployBlockedReason?: string;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-xs leading-relaxed text-primary-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  // -- pending ------------------------------------------------------------
  if (message.pending) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Thinking…
      </div>
    );
  }

  // -- failed -------------------------------------------------------------
  if (message.error) {
    return (
      <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
        <span className="text-muted-foreground">{message.error}</span>
      </div>
    );
  }

  // -- assistant ----------------------------------------------------------
  return (
    <div className="space-y-1">
      <div className="text-xs leading-relaxed whitespace-pre-wrap">{message.content}</div>

      {message.model && (
        <p className="text-[10px] text-muted-foreground/60">{message.model}</p>
      )}

      {/* The model replied, but not in the contract shape. */}
      {message.parseError && (
        <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/5 p-2.5 text-[11px]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <div className="min-w-0">
            <p>{message.parseError}</p>
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[10px] text-muted-foreground">
                Show the raw reply
              </summary>
              <pre className="code-block mt-1.5 max-h-40 overflow-auto rounded border bg-muted/50 p-2 text-[10px] whitespace-pre-wrap">
                {message.content || "(empty)"}
              </pre>
            </details>
          </div>
        </div>
      )}

      {message.artifact && (
        <CopilotCommandCard
          artifact={message.artifact}
          existingCommand={existingCommand}
          apiKey={apiKey}
          botId={botId}
          canDeploy={canDeploy}
          deployBlockedReason={deployBlockedReason}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

export function AICopilotDrawer() {
  const open = useCopilot((state) => state.open);
  const setOpen = useCopilot((state) => state.setOpen);
  const messages = useCopilot((state) => state.messages);
  const status = useCopilot((state) => state.status);
  const clear = useCopilot((state) => state.clear);
  const pushUserMessage = useCopilot((state) => state.pushUserMessage);
  const pushAssistantPlaceholder = useCopilot((state) => state.pushAssistantPlaceholder);
  const resolveAssistant = useCopilot((state) => state.resolveAssistant);
  const failAssistant = useCopilot((state) => state.failAssistant);
  const setContext = useCopilot((state) => state.setContext);

  const credentials = useCredentials((state) => state.credentials);

  const [bots, setBots] = React.useState<BotListItem[]>([]);
  const [selectedBotId, setSelectedBotId] = React.useState<number | null>(null);
  const [commands, setCommands] = React.useState<TblCommand[]>([]);
  const [loadingContext, setLoadingContext] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [showTemplates, setShowTemplates] = React.useState(false);

  const bottomRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const llm = credentials?.llm;
  const apiKey = credentials?.telebothost.apiKey ?? "";
  const canDeploy = Boolean(
    credentials && credentials.telebothost.keyType === "secret" && selectedBotId,
  );

  const deployBlockedReason = !credentials
    ? "Connect your credentials first."
    : credentials.telebothost.keyType !== "secret"
      ? "A read-only key cannot write commands."
      : !selectedBotId
        ? "Select a bot above."
        : undefined;

  const modelLabel = llm
    ? `${LLM_PROVIDERS[llm.provider]?.label ?? llm.provider} · ${llm.model}`
    : null;

  // ---- Load the bot list ------------------------------------------------
  React.useEffect(() => {
    if (!open || !apiKey) return;

    let cancelled = false;
    (async () => {
      setLoadingContext(true);
      const result = await clientApi.listBots(apiKey);
      if (cancelled) return;

      if (result.ok && result.data) {
        const list = result.data.bots ?? [];
        setBots(list);
        setSelectedBotId((current) => current ?? list[0]?.bot_id ?? null);
      }
      setLoadingContext(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, apiKey]);

  // ---- Load commands for the selected bot --------------------------------
  const refreshCommands = React.useCallback(async () => {
    if (!apiKey || !selectedBotId) {
      setCommands([]);
      return;
    }

    setLoadingContext(true);
    const { commands: loaded, error } = await loadBotCommands(apiKey, selectedBotId);
    if (error) toast.error("Could not load bot context", { description: error });
    setCommands(loaded);
    setLoadingContext(false);
  }, [apiKey, selectedBotId]);

  React.useEffect(() => {
    if (!open) return;
    void refreshCommands();
  }, [open, refreshCommands]);

  // ---- Keep the shared context snapshot current --------------------------
  const context: CopilotBotContext = React.useMemo(
    () =>
      buildBotContext({
        bot: bots.find((bot) => bot.bot_id === selectedBotId) ?? null,
        commands,
        hasWriteKey: credentials?.telebothost.keyType === "secret",
        activeSurface: "none",
      }),
    [bots, selectedBotId, commands, credentials],
  );

  React.useEffect(() => {
    setContext(context);
  }, [context, setContext]);

  // ---- Auto-scroll -------------------------------------------------------
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, status]);

  // ---- Send a turn -------------------------------------------------------
  const send = React.useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || status === "thinking") return;

      if (!llm?.apiKey) {
        toast.error("No model configured", {
          description: "Add a model API key under Credentials to use free-form requests.",
        });
        return;
      }

      setDraft("");
      pushUserMessage(content);
      const placeholderId = pushAssistantPlaceholder();

      try {
        const response = await fetch("/api/copilot/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-llm-key": llm.apiKey,
            "x-llm-provider": llm.provider,
            "x-llm-model": llm.model,
            ...(llm.baseUrl ? { "x-llm-base-url": llm.baseUrl } : {}),
          },
          body: JSON.stringify({
            messages: toApiMessages(useCopilot.getState().messages),
            context,
          }),
        });

        const payload = (await response.json().catch(() => null)) as
          | {
              ok: boolean;
              data?: {
                artifact: CopilotArtifact | null;
                raw: string;
                parseError: string | null;
                model: string;
              };
              error?: { message: string; hint?: string };
            }
          | null;

        if (!payload) {
          failAssistant(placeholderId, {
            message: "The server returned an unreadable response.",
          });
          return;
        }

        if (!payload.ok) {
          // A 502/504 from a serverless host usually means the platform cut the
          // request before the model finished. Say so, rather than "network error".
          const isTimeout = response.status === 502 || response.status === 504;
          failAssistant(placeholderId, {
            message: payload.error?.message ?? "The request failed.",
            hint: isTimeout
              ? "If you are hosted on a serverless platform, its request timeout may be shorter than the model's response time. Try a faster model."
              : payload.error?.hint,
          });
          return;
        }

        resolveAssistant(placeholderId, {
          content:
            payload.data?.artifact?.explanation ??
            payload.data?.parseError ??
            "The model returned no usable content.",
          artifact: payload.data?.artifact ?? undefined,
          parseError: payload.data?.parseError ?? undefined,
          model: payload.data?.model,
        });

        // A newly deployed command changes the context for the next turn.
        void refreshCommands();
      } catch (error) {
        failAssistant(placeholderId, {
          message:
            error instanceof Error
              ? `Could not reach the copilot route: ${error.message}`
              : "Could not reach the copilot route.",
        });
      }
    },
    [
      status,
      llm,
      context,
      pushUserMessage,
      pushAssistantPlaceholder,
      resolveAssistant,
      failAssistant,
      refreshCommands,
    ],
  );

  // ---- Insert a starter template locally (no model needed) ---------------
  function useTemplate(templateId: string) {
    const template = STARTER_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;

    const id = pushAssistantPlaceholder();
    resolveAssistant(id, {
      content: `${template.artifact.explanation}\n\n(Inserted from the built-in template library — no model needed.)`,
      artifact: template.artifact,
      model: "template",
    });
    setShowTemplates(false);
  }

  // ---- Collapsed: a floating launcher ------------------------------------
  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 h-11 gap-2 rounded-full px-4 shadow-lg"
        aria-label="Open AI Bot Engineer"
      >
        <Sparkles className="size-4" />
        AI Bot Engineer
      </Button>
    );
  }

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex flex-col border-l bg-background shadow-2xl"
      style={{ width: DRAWER_WIDTH }}
      aria-label="AI Bot Engineer"
    >
      {/* ---- Header ---- */}
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Wand2 className="size-3.5 text-primary" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight">AI Bot Engineer</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {modelLabel ?? "No model configured"}
          </div>
        </div>

        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            onClick={() => {
              clear();
              toast.success("Conversation cleared");
            }}
            aria-label="Clear conversation"
          >
            <Eraser className="size-3.5" />
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          onClick={() => setOpen(false)}
          aria-label="Collapse copilot"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/* ---- Bot context ---- */}
      <ContextBar
        bots={bots}
        selectedBotId={selectedBotId}
        onSelectBot={setSelectedBotId}
        commands={commands}
        loading={loadingContext}
        onRefresh={() => void refreshCommands()}
      />

      {/* ---- No model configured ---- */}
      {!llm?.apiKey && (
        <div className="flex gap-2 border-b border-warning/40 bg-warning/5 p-3">
          <KeyRound className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <div className="min-w-0 text-[11px]">
            <p className="font-medium">No model configured</p>
            <p className="mt-0.5 text-muted-foreground">
              Free-form requests need a model API key. The starter templates below work without one.
            </p>
            <Button asChild size="sm" variant="outline" className="mt-2 h-7 text-[11px]">
              <Link href="/setup">Add a model key</Link>
            </Button>
          </div>
        </div>
      )}

      {/* ---- Messages ---- */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          {messages.length === 0 && (
            <div className="space-y-3 pt-2">
              <div className="rounded-xl border bg-card p-3">
                <p className="text-xs font-medium">Describe what you want the bot to do</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  The copilot knows this bot&apos;s existing commands, so it will not duplicate a
                  trigger you already have. It writes real TBL and you can deploy it in one click.
                </p>
              </div>

              <div className="space-y-1.5">
                <p className="px-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Try one of these
                </p>
                {SUGGESTION_CHIPS.map((chip) => {
                  const Icon = chip.icon;
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => void send(buildChipPrompt(chip.id, chip.label))}
                      disabled={!llm?.apiKey || status === "thinking"}
                      title={chip.description}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg border bg-card p-2.5 text-left transition-colors",
                        "hover:border-primary/40 hover:bg-accent/60",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                      )}
                    >
                      <Icon className="size-3.5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 text-[11px] font-medium">{chip.label}</span>
                      <ChevronLeft className="size-3 shrink-0 rotate-180 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>

              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setShowTemplates((value) => !value)}
                  className="flex w-full items-center gap-1.5 px-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
                >
                  <Layers className="size-3" />
                  Starter templates
                  <span className="ml-auto text-muted-foreground/60">
                    {showTemplates ? "hide" : `${STARTER_TEMPLATES.length} ready to deploy`}
                  </span>
                </button>

                {showTemplates &&
                  STARTER_TEMPLATES.map((template) => {
                    const Icon = template.icon;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => useTemplate(template.id)}
                        title={template.summary}
                        className="flex w-full items-start gap-2.5 rounded-lg border border-dashed bg-card p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/60"
                      >
                        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] font-medium">{template.title}</span>
                          <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                            {template.summary}
                          </span>
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              existingCommand={
                message.artifact
                  ? commands.find(
                      (command) =>
                        command.name.trim().toLowerCase() ===
                        message.artifact?.command_name.trim().toLowerCase(),
                    )
                  : undefined
              }
              apiKey={apiKey}
              botId={selectedBotId}
              canDeploy={canDeploy}
              deployBlockedReason={deployBlockedReason}
            />
          ))}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* ---- Composer ---- */}
      <div className="border-t p-3">
        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
            placeholder={
              llm?.apiKey
                ? "Describe the feature you want… (Enter to send, Shift+Enter for a new line)"
                : "Add a model key under Credentials to use free-form requests"
            }
            disabled={!llm?.apiKey}
            rows={2}
            aria-label="Message the AI Bot Engineer"
            className="min-h-[3.5rem] resize-none pr-11 text-xs"
          />

          <Button
            size="icon-sm"
            className="absolute right-1.5 bottom-1.5 size-7"
            onClick={() => void send(draft)}
            disabled={!draft.trim() || status === "thinking" || !llm?.apiKey}
            aria-label="Send"
          >
            {status === "thinking" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
          </Button>
        </div>

        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
          <CircleDot className="size-2.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {context.botId === null
              ? "No bot selected — the copilot has no context."
              : `Context: ${context.commands.length} commands, ${context.variables.length} variables`}
          </span>

          {messages.length > 0 && (
            <button
              type="button"
              onClick={clear}
              className="flex shrink-0 items-center gap-1 hover:text-foreground"
            >
              <Trash2 className="size-2.5" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* A close affordance for very narrow screens. */}
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute top-2.5 -left-8 hidden size-7 xl:hidden"
        onClick={() => setOpen(false)}
        aria-label="Close copilot"
      >
        <X className="size-4" />
      </Button>
    </aside>
  );
}
