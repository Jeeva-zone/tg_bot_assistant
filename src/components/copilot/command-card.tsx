"use client";

import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  FileCode2,
  GitCompare,
  Info,
  Keyboard as KeyboardIcon,
  Loader2,
  Rocket,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeBlock } from "@/components/copilot/code-block";
import { DiffView } from "@/components/copilot/diff-view";
import { buildDeployPayload, deployGeneratedCommand } from "@/lib/copilot/deploy";
import { normaliseKeyboard } from "@/lib/copilot/schema";
import { copyToClipboard } from "@/lib/utils";
import type { CopilotArtifact } from "@/types/copilot";
import type { TblCommand } from "@/types/telebothost";

/**
 * The card for one generated (or templated) command.
 *
 * This is where the copilot's output becomes action: the explanation, the code, the
 * diff against what is already deployed, and the button that ships it.
 *
 * The deploy button's label is derived from the diff — it says "Update" when a command
 * with this trigger already exists and "Deploy" when it does not — because TBL matches
 * exactly one command per trigger, so the user needs to know which of the two is about
 * to happen.
 */
export function CopilotCommandCard({
  artifact,
  existingCommand,
  apiKey,
  botId,
  canDeploy,
  deployBlockedReason,
}: {
  artifact: CopilotArtifact;
  existingCommand?: TblCommand;
  apiKey: string;
  botId: number | null;
  canDeploy: boolean;
  deployBlockedReason?: string;
}) {
  const [deploying, setDeploying] = React.useState(false);
  const [deployed, setDeployed] = React.useState<"created" | "updated" | null>(null);
  const [copied, setCopied] = React.useState(false);

  const keyboard = React.useMemo(() => normaliseKeyboard(artifact.keyboard), [artifact.keyboard]);
  const payload = React.useMemo(() => buildDeployPayload(artifact), [artifact]);

  const existingCode = existingCommand?.code ?? "";
  const isUpdate = Boolean(existingCommand);

  async function handleCopy() {
    const ok = await copyToClipboard(artifact.tbl_code);
    if (ok) {
      setCopied(true);
      toast.success("Code copied");
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("Could not copy to clipboard");
    }
  }

  async function handleDeploy() {
    if (botId === null) return;

    setDeploying(true);
    const result = await deployGeneratedCommand({
      apiKey,
      botId,
      artifact,
      existingCommands: existingCommand ? [existingCommand] : [],
    });
    setDeploying(false);

    if (result.ok && result.action) {
      setDeployed(result.action);
      toast.success(
        result.action === "created"
          ? `Deployed \`${result.commandName}\` to TeleBotHost`
          : `Updated \`${result.commandName}\` on TeleBotHost`,
        { description: `${result.codeLength?.toLocaleString() ?? 0} characters of code uploaded.` },
      );
    } else {
      toast.error("Deploy failed", {
        description: result.error,
      });
    }
  }

  return (
    <div className="mt-2.5 space-y-3 rounded-xl border bg-card p-3 shadow-sm">
      {/* ---- Header ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs font-medium text-primary">
          {artifact.command_name}
        </code>

        {artifact.need_reply && (
          <Badge variant="secondary" className="text-[10px]">
            multi-step
          </Badge>
        )}
        {artifact.aliases && artifact.aliases.length > 0 && (
          <Badge variant="muted" className="text-[10px]">
            aliases: {artifact.aliases.join(", ")}
          </Badge>
        )}
        <Badge variant="muted" className="text-[10px]">
          {artifact.tbl_code.length.toLocaleString()} chars
        </Badge>

        {isUpdate ? (
          <Badge variant="warning" className="text-[10px]">
            replaces existing
          </Badge>
        ) : (
          <Badge variant="success" className="text-[10px]">
            new command
          </Badge>
        )}
      </div>

      {/* ---- Explanation ---- */}
      <p className="text-xs leading-relaxed whitespace-pre-wrap">{artifact.explanation}</p>

      {/* ---- Notes ---- */}
      {artifact.notes && artifact.notes.length > 0 && (
        <ul className="space-y-1">
          {artifact.notes.map((note, index) => (
            <li
              key={index}
              className="flex gap-1.5 rounded-md bg-muted/50 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground"
            >
              <Info className="mt-px size-3 shrink-0" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}

      {/* ---- Keyboard ---- */}
      {keyboard && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <KeyboardIcon className="size-3" />
            {keyboard.kind === "inline" ? "Inline keyboard" : "Reply keyboard"}
          </div>

          <div className="space-y-0.5">
            {keyboard.rows.map((row, rowIndex) => (
              <div key={rowIndex} className="flex gap-0.5">
                {row.map((label, labelIndex) => (
                  <span
                    key={labelIndex}
                    className="min-w-0 flex-1 truncate rounded border bg-background px-1.5 py-1 text-center text-[10px]"
                  >
                    {label}
                  </span>
                ))}
              </div>
            ))}
          </div>

          {keyboard.warning && (
            <p className="flex gap-1.5 rounded-md border border-warning/40 bg-warning/5 p-2 text-[10px] leading-snug">
              <AlertTriangle className="mt-px size-3 shrink-0 text-warning" />
              <span>{keyboard.warning}</span>
            </p>
          )}
        </div>
      )}

      {/* ---- Code / diff ---- */}
      <Tabs defaultValue="diff" className="gap-2">
        <TabsList className="h-7 w-full justify-start">
          <TabsTrigger value="diff" className="h-6 gap-1.5 px-2.5 text-[11px]">
            <GitCompare className="size-3" />
            Diff
          </TabsTrigger>
          <TabsTrigger value="code" className="h-6 gap-1.5 px-2.5 text-[11px]">
            <FileCode2 className="size-3" />
            Code
          </TabsTrigger>
          <TabsTrigger value="payload" className="h-6 gap-1.5 px-2.5 text-[11px]">
            <Sparkles className="size-3" />
            Payload
          </TabsTrigger>
        </TabsList>

        <TabsContent value="diff" className="m-0">
          <DiffView
            oldCode={existingCode}
            newCode={artifact.tbl_code}
            oldLabel={isUpdate ? `Deployed \`${artifact.command_name}\`` : "Nothing deployed"}
            newLabel="Generated"
          />
        </TabsContent>

        <TabsContent value="code" className="m-0">
          {artifact.tbl_code.trim() ? (
            <CodeBlock code={artifact.tbl_code} maxHeight="max-h-[22rem]" />
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-center text-[11px] text-muted-foreground">
              This command has no logic — it only sends the answer text.
            </p>
          )}
        </TabsContent>

        <TabsContent value="payload" className="m-0">
          <div className="space-y-2">
            <p className="text-[10px] leading-snug text-muted-foreground">
              Exactly what gets sent to{" "}
              <code className="rounded bg-muted px-1">
                POST https://api.telebothost.com/api/v1/bot/{"{botid}"}/commands
              </code>
            </p>
            <CodeBlock code={JSON.stringify(payload, null, 2)} maxHeight="max-h-72" />
          </div>
        </TabsContent>
      </Tabs>

      {/* ---- Actions ---- */}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button
          size="sm"
          onClick={() => void handleDeploy()}
          disabled={deploying || !canDeploy || deployed !== null}
          title={!canDeploy ? deployBlockedReason : undefined}
        >
          {deploying ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Deploying…
            </>
          ) : deployed ? (
            <>
              <CheckCircle2 className="size-3.5" />
              {deployed === "created" ? "Deployed" : "Updated"}
            </>
          ) : (
            <>
              <Rocket className="size-3.5" />
              🚀 {isUpdate ? "Update on TeleBotHost" : "Deploy directly to TeleBotHost"}
            </>
          )}
        </Button>

        <Button variant="outline" size="sm" onClick={() => void handleCopy()}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy code"}
        </Button>

        {!canDeploy && deployBlockedReason && (
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <AlertCircle className="size-3" />
            {deployBlockedReason}
          </span>
        )}
      </div>
    </div>
  );
}
