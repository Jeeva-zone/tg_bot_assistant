"use client";

import * as React from "react";
import { FileText, Image as ImageIcon, Info, Music, Paperclip, Plus, Trash2, Video } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { TBH_CAPACITY } from "@/types/telebothost";
import type { CommandNode, MediaKind, TblParseMode } from "@/types/builder";
import { useBuilder } from "@/store/useBuilder";

const PARSE_MODES: { value: TblParseMode; label: string; hint: string }[] = [
  { value: "Markdown", label: "Markdown", hint: "*bold*, _italic_, `code`" },
  { value: "MarkdownV2", label: "MarkdownV2", hint: "Telegram MarkdownV2 rules" },
  { value: "HTML", label: "HTML", hint: "<b>bold</b>, <i>italic</i>" },
];

const MEDIA_KINDS: { value: MediaKind; label: string; icon: React.ElementType }[] = [
  { value: "photo", label: "Photo", icon: ImageIcon },
  { value: "document", label: "Document", icon: Paperclip },
  { value: "video", label: "Video", icon: Video },
  { value: "audio", label: "Audio", icon: Music },
];

export function ResponsePanel({ node }: { node: CommandNode }) {
  const updateResponse = useBuilder((state) => state.updateResponse);
  const addMedia = useBuilder((state) => state.addMedia);
  const updateMedia = useBuilder((state) => state.updateMedia);
  const removeMedia = useBuilder((state) => state.removeMedia);

  const textLength = node.response.text.length;
  const overLimit = textLength > TBH_CAPACITY.maxAnswerChars;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="response-text">Response text</Label>
          <span
            className={
              overLimit ? "font-mono text-[11px] text-destructive" : "font-mono text-[11px] text-muted-foreground"
            }
          >
            {textLength.toLocaleString()} / {TBH_CAPACITY.maxAnswerChars.toLocaleString()}
          </span>
        </div>

        <Textarea
          id="response-text"
          value={node.response.text}
          onChange={(event) => updateResponse(node.id, { text: event.target.value })}
          placeholder={"Welcome! I'm your bot.\n\nTry /help to see what I can do."}
          rows={7}
          aria-invalid={overLimit}
          className="font-mono text-sm"
        />

        {overLimit && (
          <p className="text-xs text-destructive">
            TeleBotHost caps a single answer at {TBH_CAPACITY.maxAnswerChars.toLocaleString()}{" "}
            characters. Move the long copy into a second command.
          </p>
        )}

        <p className="flex gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          This is sent before the logic runs. Commands that need media, inline buttons or a
          multi-step form send everything from generated code instead, so this field is left empty.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="parse-mode">Formatting</Label>
        <Select
          value={node.response.parseMode}
          onValueChange={(value) => updateResponse(node.id, { parseMode: value as TblParseMode })}
        >
          <SelectTrigger id="parse-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PARSE_MODES.map((mode) => (
              <SelectItem key={mode.value} value={mode.value}>
                {mode.label}
                <span className="ml-2 text-xs text-muted-foreground">{mode.hint}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Applies to this response only. Messages sent from generated logic carry their own parse
          mode.
        </p>
      </div>

      <Separator />

      {/* ---- Media attachments ---- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="flex items-center gap-2">
              <FileText className="size-3.5 text-muted-foreground" />
              Media attachments
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Sent before the text, in order. Use a public URL or a Telegram file_id.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => addMedia(node.id)}>
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>

        {node.response.media.length === 0 && (
          <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            No attachments. The response will be text only.
          </p>
        )}

        {node.response.media.map((item, index) => {
          const meta = MEDIA_KINDS.find((kind) => kind.value === item.kind);
          const Icon = meta?.icon ?? ImageIcon;

          return (
            <div key={item.id} className="space-y-2.5 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <Select
                  value={item.kind}
                  onValueChange={(value) =>
                    updateMedia(node.id, item.id, { kind: value as MediaKind })
                  }
                >
                  <SelectTrigger className="h-7 w-[130px] text-xs" aria-label={`Attachment ${index + 1} type`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEDIA_KINDS.map((kind) => (
                      <SelectItem key={kind.value} value={kind.value}>
                        {kind.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Badge variant="muted" className="ml-auto text-[10px]">
                  #{index + 1}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeMedia(node.id, item.id)}
                  aria-label="Remove attachment"
                  className="size-6 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>

              <Input
                value={item.source}
                onChange={(event) =>
                  updateMedia(node.id, item.id, { source: event.target.value })
                }
                placeholder="https://example.com/image.png"
                aria-label="Media URL"
                className="font-mono text-xs"
              />

              <Input
                value={item.caption}
                onChange={(event) =>
                  updateMedia(node.id, item.id, { caption: event.target.value })
                }
                placeholder="Optional caption"
                aria-label="Caption"
                className="text-xs"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
