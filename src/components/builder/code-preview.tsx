"use client";

import * as React from "react";
import { Check, Code2, Copy, Info } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { CommandNode } from "@/types/builder";
import { keyboardToTblString, previewCommandCode, triggerToName } from "@/lib/compiler";
import { copyToClipboard } from "@/lib/utils";

/** Rows describing the exact payload TeleBotHost will receive for this node. */
function PayloadSummary({ node }: { node: CommandNode }) {
  const name = triggerToName(node.trigger);
  const code = previewCommandCode(node);
  const keyboard = keyboardToTblString(node.keyboard);
  const deliverFromCode =
    code.length > 0 && node.response.text.trim().length === 0 && !node.flow.enabled;

  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: "name", value: name || "—", mono: true },
    {
      label: "answer",
      value:
        deliverFromCode || (node.flow.enabled && node.flow.steps.length > 0)
          ? "(empty — sent from code)"
          : node.response.text.trim() || "(empty)",
    },
    { label: "parse_mode", value: node.response.parseMode, mono: true },
    { label: "keyboard", value: keyboard || "(none)", mono: true },
    {
      label: "aliases",
      value: node.aliases.length > 0 ? node.aliases.join(", ") : "(none)",
      mono: true,
    },
    {
      label: "need_reply",
      value: String(node.needReply || (node.flow.enabled && node.flow.steps.length > 0)),
      mono: true,
    },
    { label: "case_insensitive", value: String(node.trigger.caseInsensitive), mono: true },
    { label: "allow_only_group", value: String(node.groupOnly), mono: true },
    { label: "is_web", value: "0", mono: true },
    { label: "folder", value: node.folder.trim() || "(ungrouped)" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label>TeleBotHost payload</Label>
        <Badge variant="muted" className="text-[10px]">
          POST /bot/{"{botid}"}/commands
        </Badge>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-xs">
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.label} className={index % 2 === 0 ? "bg-muted/30" : undefined}>
                <td className="w-40 border-b px-3 py-2 align-top font-mono text-[11px] text-muted-foreground">
                  {row.label}
                </td>
                <td
                  className={`border-b px-3 py-2 align-top break-words ${
                    row.mono ? "font-mono text-[11px]" : ""
                  }`}
                >
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("Could not copy to clipboard");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2">
          <Code2 className="size-3.5 text-muted-foreground" />
          {label}
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleCopy()}
          disabled={!code}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {code ? (
        <ScrollArea className="h-72 rounded-lg border bg-muted/40">
          <pre className="code-block p-3">
            <code>{code}</code>
          </pre>
        </ScrollArea>
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
          This command is pure configuration — no logic code is generated. TeleBotHost will send the
          answer field directly.
        </p>
      )}
    </div>
  );
}

export function CodePreviewPanel({ node }: { node: CommandNode }) {
  const code = previewCommandCode(node);

  return (
    <div className="space-y-6">
      <PayloadSummary node={node} />

      <Separator />

      <CodeBlock code={code} label="Generated TBL logic" />

      <p className="flex gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        TBL is plain JavaScript with bot helpers already in scope —{" "}
        <code className="rounded bg-muted px-1">Bot</code>,{" "}
        <code className="rounded bg-muted px-1">Api</code>,{" "}
        <code className="rounded bg-muted px-1">db</code>,{" "}
        <code className="rounded bg-muted px-1">user</code>,{" "}
        <code className="rounded bg-muted px-1">chat</code> and{" "}
        <code className="rounded bg-muted px-1">params</code> need no imports.
      </p>
    </div>
  );
}
