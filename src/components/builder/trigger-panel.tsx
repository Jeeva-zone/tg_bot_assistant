"use client";

import * as React from "react";
import { AlertTriangle, Info, Plus, Tag, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { TRIGGER_KIND_META, type CommandNode, type TriggerKind } from "@/types/builder";
import { useBuilder } from "@/store/useBuilder";

const KIND_ORDER: TriggerKind[] = ["command", "keyword", "regex", "wildcard", "callback"];

export function TriggerPanel({ node }: { node: CommandNode }) {
  const updateTrigger = useBuilder((state) => state.updateTrigger);
  const setAliases = useBuilder((state) => state.setAliases);
  const setGroupOnly = useBuilder((state) => state.setGroupOnly);
  const setNeedReply = useBuilder((state) => state.setNeedReply);
  const setFolder = useBuilder((state) => state.setFolder);

  const [aliasDraft, setAliasDraft] = React.useState("");
  const meta = TRIGGER_KIND_META[node.trigger.kind];

  // Switching trigger kind resets the value to that kind's sensible default —
  // carrying "/start" over into a regex field would just be invalid.
  function changeKind(kind: TriggerKind) {
    const defaults: Record<TriggerKind, string> = {
      command: "/start",
      keyword: "",
      regex: "",
      wildcard: "*",
      callback: "",
    };
    updateTrigger(node.id, { kind, value: defaults[kind] });
  }

  function commitAlias() {
    const value = aliasDraft.trim();
    if (!value || node.aliases.includes(value)) {
      setAliasDraft("");
      return;
    }
    setAliases(node.id, [...node.aliases, value]);
    setAliasDraft("");
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="trigger-kind">Trigger type</Label>
        <Select value={node.trigger.kind} onValueChange={(value) => changeKind(value as TriggerKind)}>
          <SelectTrigger id="trigger-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KIND_ORDER.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {TRIGGER_KIND_META[kind].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="flex gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {meta.description}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="trigger-value">
          {node.trigger.kind === "regex" ? "Pattern" : "Match value"}
        </Label>
        <Input
          id="trigger-value"
          value={node.trigger.value}
          onChange={(event) => updateTrigger(node.id, { value: event.target.value })}
          placeholder={meta.placeholder}
          disabled={node.trigger.kind === "wildcard"}
          spellCheck={false}
          className="font-mono text-sm"
        />

        {node.trigger.kind === "wildcard" && (
          <p className="text-xs text-muted-foreground">
            The wildcard is always <code className="rounded bg-muted px-1">*</code> and runs when no
            other command matches. Only one is allowed per bot.
          </p>
        )}

        {node.trigger.kind === "regex" && (
          <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            <span>
              TeleBotHost routes on exact names and has no regex matching, so this rule is compiled
              into the shared <code className="rounded bg-muted px-1">*</code> fallback command.
              Rules run in the order shown, first match wins.
            </span>
          </div>
        )}

        {node.trigger.kind === "callback" && (
          <p className="text-xs text-muted-foreground">
            Matches the <code className="rounded bg-muted px-1">callback_data</code> of an inline
            button. Set a button&apos;s value to this string to wire them together.
          </p>
        )}
      </div>

      {(node.trigger.kind === "command" || node.trigger.kind === "keyword") && (
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="pr-4">
            <Label htmlFor="case-insensitive" className="text-sm">
              Ignore case
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Match regardless of capitalisation. Cannot be combined with another command whose name
              differs only by case.
            </p>
          </div>
          <Switch
            id="case-insensitive"
            checked={node.trigger.caseInsensitive}
            onCheckedChange={(checked) => updateTrigger(node.id, { caseInsensitive: checked })}
          />
        </div>
      )}

      <Separator />

      {/* Aliases */}
      <div className="space-y-2">
        <Label htmlFor="alias-input" className="flex items-center gap-2">
          <Tag className="size-3.5 text-muted-foreground" />
          Aliases
        </Label>
        <p className="text-xs text-muted-foreground">
          Alternative triggers for this same command. Aliases are case-sensitive — a keyboard button
          labelled <code className="rounded bg-muted px-1">Help</code> needs an alias{" "}
          <code className="rounded bg-muted px-1">Help</code>, not{" "}
          <code className="rounded bg-muted px-1">help</code>.
        </p>

        {node.aliases.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {node.aliases.map((alias) => (
              <Badge key={alias} variant="secondary" className="gap-1 font-mono text-[11px]">
                {alias}
                <button
                  type="button"
                  onClick={() =>
                    setAliases(
                      node.id,
                      node.aliases.filter((value) => value !== alias),
                    )
                  }
                  aria-label={`Remove alias ${alias}`}
                  className="rounded-full p-0.5 hover:bg-destructive/20"
                >
                  <X className="size-2.5" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            id="alias-input"
            value={aliasDraft}
            onChange={(event) => setAliasDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitAlias();
              }
            }}
            placeholder="e.g. Help or /h"
            className="font-mono text-sm"
          />
          <Button type="button" variant="outline" size="icon" onClick={commitAlias} aria-label="Add alias">
            <Plus className="size-4" />
          </Button>
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="pr-4">
            <Label htmlFor="need-reply" className="text-sm">
              Need reply
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pause after the response and run this logic again with the user&apos;s next message.
              Required for multi-step forms.
            </p>
          </div>
          <Switch
            id="need-reply"
            checked={node.needReply || (node.flow.enabled && node.flow.steps.length > 0)}
            disabled={node.flow.enabled && node.flow.steps.length > 0}
            onCheckedChange={(checked) => setNeedReply(node.id, checked)}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="pr-4">
            <Label htmlFor="group-only" className="text-sm">
              Group chats only
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ignore this command in private chats.
            </p>
          </div>
          <Switch
            id="group-only"
            checked={node.groupOnly}
            onCheckedChange={(checked) => setGroupOnly(node.id, checked)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="folder">Folder</Label>
          <Input
            id="folder"
            value={node.folder}
            onChange={(event) => setFolder(node.id, event.target.value)}
            placeholder="Ungrouped"
          />
          <p className="text-xs text-muted-foreground">
            Optional TeleBotHost folder name for organising commands in the console. Maximum 50
            folders per bot.
          </p>
        </div>
      </div>
    </div>
  );
}
