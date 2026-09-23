"use client";

import * as React from "react";
import { Check, Copy, FileCode2, Info, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, copyToClipboard } from "@/lib/utils";
import type { WorkflowCompileResult } from "@/types/workflow";

/**
 * Shows exactly what will be sent to TeleBotHost, one tab per generated command.
 *
 * Being able to read the compiled output is the point of a visual builder: if the
 * generated TBL is wrong, the author needs to see that before deploying, not after
 * their bot misbehaves.
 */
export function CodeOutputPanel({ compiled }: { compiled: WorkflowCompileResult }) {
  const [copiedName, setCopiedName] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState("0");

  // Keep the active tab valid when the graph changes and commands appear/disappear.
  React.useEffect(() => {
    const index = Number(activeTab);
    if (Number.isNaN(index) || index >= compiled.commands.length) {
      setActiveTab("0");
    }
  }, [compiled.commands.length, activeTab]);

  async function handleCopy(name: string, code: string) {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopiedName(name);
      toast.success(`Copied ${name}`);
      setTimeout(() => setCopiedName(null), 2000);
    } else {
      toast.error("Could not copy to clipboard");
    }
  }

  async function handleCopyAll() {
    const bundle = compiled.commands
      .map((command) => `// ===== ${command.name} =====\n${command.code}`)
      .join("\n\n");
    const ok = await copyToClipboard(bundle);
    if (ok) toast.success(`Copied ${compiled.commands.length} command(s)`);
    else toast.error("Could not copy to clipboard");
  }

  if (compiled.commands.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <FileCode2 className="size-7 text-muted-foreground/50" />
        <p className="text-sm font-medium">No code generated yet</p>
        <p className="max-w-[18rem] text-xs text-muted-foreground">
          Connect a Trigger block to at least one action block, and the compiled TBL will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Terminal className="size-3.5 text-muted-foreground" />
        <h2 className="text-xs font-semibold">Generated TBL</h2>

        <Badge variant="muted" className="text-[9px]">
          {compiled.stats.commandCount} command{compiled.stats.commandCount === 1 ? "" : "s"}
        </Badge>

        {compiled.stats.stateBlocks > 0 && (
          <Badge variant="secondary" className="text-[9px]">
            {compiled.stats.stateBlocks} pause{compiled.stats.stateBlocks === 1 ? "" : "s"}
          </Badge>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="ml-auto text-muted-foreground" aria-label="About the output">
              <Info className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            This is the exact code uploaded to TeleBotHost. TBL is plain JavaScript with Bot, Api, db
            and the message globals already in scope.
          </TooltipContent>
        </Tooltip>

        <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => void handleCopyAll()}>
          <Copy className="size-3" />
          Copy all
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="border-b px-2 py-1.5">
          <TabsList className="h-7 w-full justify-start overflow-x-auto bg-transparent p-0">
            {compiled.commands.map((command, index) => (
              <TabsTrigger
                key={`${command.name}-${index}`}
                value={String(index)}
                className="h-6 shrink-0 px-2 font-mono text-[10px] data-[state=active]:bg-muted"
              >
                {command.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {compiled.commands.map((command, index) => (
          <TabsContent
            key={`${command.name}-${index}`}
            value={String(index)}
            className="m-0 flex min-h-0 flex-1 flex-col"
          >
            {/* Per-command metadata strip */}
            <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
              <Badge variant="muted" className="text-[9px]">
                {command.code.length.toLocaleString()} chars
              </Badge>
              {command.need_reply && (
                <Badge variant="secondary" className="text-[9px]">
                  need_reply
                </Badge>
              )}
              {command.case_insensitive && (
                <Badge variant="muted" className="text-[9px]">
                  case-insensitive
                </Badge>
              )}
              {command.allow_only_group && (
                <Badge variant="muted" className="text-[9px]">
                  groups only
                </Badge>
              )}
              {command.aliases.length > 0 && (
                <Badge variant="muted" className="text-[9px]">
                  aliases: {command.aliases.join(", ")}
                </Badge>
              )}

              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-6 text-[10px]"
                onClick={() => void handleCopy(command.name, command.code)}
              >
                {copiedName === command.name ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
                Copy
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <pre
                className={cn(
                  "code-block p-3 text-[11px] whitespace-pre",
                  command.code.trim().length === 0 && "text-muted-foreground",
                )}
              >
                <code>{command.code.trim() || "// This command has no logic — it is configuration only."}</code>
              </pre>
            </ScrollArea>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
