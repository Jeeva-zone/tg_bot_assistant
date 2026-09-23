"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle, Ban, CheckCircle2, Clock, KeyRound, Loader2, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  deployCompiledCommands,
  type DeployOutcome,
} from "@/lib/deploy-engine";
import { formatDuration } from "@/lib/utils";
import * as vault from "@/lib/vault";
import { useCredentials } from "@/store/useCredentials";
import type { DeploymentLogLine, DeploymentRecord } from "@/types/builder";
import type { WorkflowCompileResult } from "@/types/workflow";

const LEVEL_COLOUR: Record<DeploymentLogLine["level"], string> = {
  info: "text-muted-foreground",
  success: "text-success",
  warn: "text-warning",
  error: "text-destructive",
};

/**
 * Compact deploy flow for the workflow canvas.
 *
 * Deliberately a dialog rather than a page: the author is looking at the graph and
 * the generated code, and should be able to ship without losing that context.
 */
export function WorkflowDeployDialog({
  open,
  onOpenChange,
  compiled,
  documentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  compiled: WorkflowCompileResult;
  documentName: string;
}) {
  const credentials = useCredentials((state) => state.credentials);

  const [reuseExistingBot, setReuseExistingBot] = React.useState(true);
  const [clearExistingCommands, setClearExistingCommands] = React.useState(true);
  const [startAfterDeploy, setStartAfterDeploy] = React.useState(true);

  const [lines, setLines] = React.useState<DeploymentLogLine[]>([]);
  const [running, setRunning] = React.useState(false);
  const [outcome, setOutcome] = React.useState<DeployOutcome | null>(null);
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });

  const abortRef = React.useRef<AbortController | null>(null);

  // Reset transient state each time the dialog is opened.
  React.useEffect(() => {
    if (!open) return;
    setLines([]);
    setOutcome(null);
    setProgress({ done: 0, total: compiled.commands.length });
  }, [open, compiled.commands.length]);

  async function handleDeploy() {
    if (!credentials) return;

    setRunning(true);
    setLines([]);
    setOutcome(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const result = await deployCompiledCommands({
      apiKey: credentials.telebothost.apiKey,
      botToken: credentials.telegram.botToken,
      botName: documentName,
      commands: compiled.commands,
      // Translate workflow issues into the engine's neutral diagnostic shape.
      diagnostics: compiled.issues.map((issue) => ({
        level: issue.severity,
        message: issue.message,
      })),
      hasErrors: compiled.hasErrors,
      reuseExistingBot,
      clearExistingCommands,
      startAfterDeploy,
      onLog: (line) => setLines((previous) => [...previous, line]),
      onProgress: (done, total) => setProgress({ done, total }),
      signal: controller.signal,
    });

    setOutcome(result);
    setRunning(false);
    abortRef.current = null;

    if (result.success) {
      toast.success("Deployed successfully", {
        description: `${result.commandCount} command(s) uploaded to @${result.botUsername}.`,
      });

      const record: DeploymentRecord = {
        id: `dep_${Date.now()}`,
        botId: result.botId ?? 0,
        botName: documentName,
        botUsername: result.botUsername ?? "",
        status: startAfterDeploy ? "online" : "offline",
        commandCount: result.commandCount,
        deployedAt: new Date().toISOString(),
        durationMs: result.durationMs,
      };
      vault.saveDeployments([record, ...vault.loadDeployments()].slice(0, 10));
    } else {
      toast.error("Deployment failed", { description: result.error });
    }
  }

  const blocked = compiled.hasErrors || compiled.commands.length === 0;
  const errors = compiled.issues.filter((issue) => issue.severity === "error").length;
  const warnings = compiled.issues.filter((issue) => issue.severity === "warning").length;

  return (
    <Dialog open={open} onOpenChange={(next) => (running ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="size-4 text-primary" />
            Deploy workflow
          </DialogTitle>
          <DialogDescription>
            Uploads the compiled commands to TeleBotHost, then optionally starts the bot.
          </DialogDescription>
        </DialogHeader>

        {!credentials ? (
          <div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="text-sm">
              <p className="font-medium">Credentials required</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Add your Telegram bot token and TeleBotHost <code>sk_</code> key first.
              </p>
              <Button asChild size="sm" className="mt-2.5">
                <Link href="/setup" onClick={() => onOpenChange(false)}>
                  Open setup
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* ---- Pre-flight ---- */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "Commands", value: compiled.stats.commandCount },
                { label: "Blocks", value: compiled.stats.nodeCount },
                { label: "Triggers", value: compiled.stats.triggerCount },
                { label: "Pauses", value: compiled.stats.stateBlocks },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border bg-muted/30 px-3 py-2">
                  <div className="font-mono text-base font-semibold">{item.value}</div>
                  <div className="text-[10px] text-muted-foreground">{item.label}</div>
                </div>
              ))}
            </div>

            {compiled.hasErrors ? (
              <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div>
                  <p className="font-medium">{errors} error(s) block deployment</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Fix them on the canvas — the compiler refuses to upload a broken bot.
                  </p>
                </div>
              </div>
            ) : warnings > 0 ? (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs">
                <p className="font-medium">{warnings} warning(s)</p>
                <p className="mt-0.5 text-muted-foreground">
                  These will not stop the deploy, but usually mean a block will not behave as intended.
                </p>
              </div>
            ) : null}

            <Separator />

            {/* ---- Options ---- */}
            <div className="space-y-2">
              {[
                {
                  id: "wf-reuse",
                  label: "Reuse an existing bot",
                  description: "Update the bot if it is already registered.",
                  checked: reuseExistingBot,
                  onChange: setReuseExistingBot,
                },
                {
                  id: "wf-clear",
                  label: "Clear existing commands",
                  description: "Wipe first so the deployed state matches this canvas exactly.",
                  checked: clearExistingCommands,
                  onChange: setClearExistingCommands,
                },
                {
                  id: "wf-start",
                  label: "Start the bot afterwards",
                  description: "Set the bot running once every command is uploaded.",
                  checked: startAfterDeploy,
                  onChange: setStartAfterDeploy,
                },
              ].map((option) => (
                <div key={option.id} className="flex items-center justify-between rounded-lg border p-2.5">
                  <div className="pr-4">
                    <Label htmlFor={option.id} className="text-xs">
                      {option.label}
                    </Label>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{option.description}</p>
                  </div>
                  <Switch
                    id={option.id}
                    checked={option.checked}
                    onCheckedChange={option.onChange}
                    disabled={running}
                  />
                </div>
              ))}
            </div>

            {/* ---- Progress ---- */}
            {running && progress.total > 0 && (
              <div className="space-y-1.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${(progress.done / progress.total) * 100}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {progress.done} / {progress.total} commands uploaded. The free tier allows 15
                  requests per minute, so large workflows are paced automatically.
                </p>
              </div>
            )}

            {/* ---- Log ---- */}
            {lines.length > 0 && (
              <ScrollArea className="h-44 rounded-lg border bg-muted/40">
                <div className="code-block p-2.5">
                  {lines.map((line, index) => (
                    <div key={index} className="flex gap-2">
                      <span className="shrink-0 text-muted-foreground/60">
                        {new Date(line.at).toLocaleTimeString("en-GB", { hour12: false })}
                      </span>
                      <span className={LEVEL_COLOUR[line.level]}>{line.message}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            {/* ---- Outcome ---- */}
            {outcome && (
              <div
                className={`flex gap-2 rounded-lg border p-3 text-sm ${
                  outcome.success
                    ? "border-success/40 bg-success/5"
                    : "border-destructive/40 bg-destructive/5"
                }`}
              >
                {outcome.success ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                )}
                <div className="min-w-0">
                  <p className="font-medium">
                    {outcome.success
                      ? `Deployed ${outcome.commandCount} command(s) to @${outcome.botUsername}`
                      : "Deployment failed"}
                  </p>
                  {!outcome.success && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {outcome.error}
                      {outcome.hint && <span className="mt-1 block">{outcome.hint}</span>}
                    </p>
                  )}
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="size-3" />
                    {formatDuration(outcome.durationMs)}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {running ? (
            <Button
              variant="outline"
              onClick={() => {
                abortRef.current?.abort();
                toast.info("Cancelling deployment…");
              }}
            >
              <Ban className="size-4" />
              Cancel
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={() => void handleDeploy()} disabled={blocked || !credentials}>
                {blocked ? (
                  <>
                    <AlertCircle className="size-4" />
                    Fix errors first
                  </>
                ) : (
                  <>
                    <Rocket className="size-4" />
                    Deploy {compiled.stats.commandCount} command(s)
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
