"use client";

import * as React from "react";
import { AlertTriangle, CornerDownLeft, Grid3x3, Link2, Plus, Trash2, Zap } from "lucide-react";
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
import type { CommandNode } from "@/types/builder";
import { useBuilder } from "@/store/useBuilder";

/** Live preview of how the reply keyboard grid will render in Telegram. */
function ReplyKeyboardPreview({ rows }: { rows: string[][] }) {
  const cleaned = rows
    .map((row) => row.map((label) => label.trim()).filter(Boolean))
    .filter((row) => row.length > 0);

  if (cleaned.length === 0) return null;

  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="mb-2 text-[11px] font-medium text-muted-foreground">Preview</p>
      <div className="space-y-1">
        {cleaned.map((row, rowIndex) => (
          <div key={rowIndex} className="flex gap-1">
            {row.map((label, labelIndex) => (
              <div
                key={labelIndex}
                className="flex-1 rounded border bg-background px-2 py-1.5 text-center text-xs shadow-xs"
              >
                {label}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function InlineKeyboardPreview({ node }: { node: CommandNode }) {
  const rows = node.response.inlineKeyboard.rows
    .map((row) => row.filter((button) => button.text.trim().length > 0))
    .filter((row) => row.length > 0);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="mb-2 text-[11px] font-medium text-muted-foreground">
        Preview — buttons sit inside the message
      </p>
      <div className="space-y-1">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex gap-1">
            {row.map((button) => (
              <div
                key={button.id}
                className="flex flex-1 items-center justify-center gap-1 rounded border bg-background px-2 py-1.5 text-center text-xs shadow-xs"
              >
                {button.action === "url" && <Link2 className="size-3 text-muted-foreground" />}
                {button.text}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReplyKeyboardEditor({ node }: { node: CommandNode }) {
  const updateKeyboard = useBuilder((state) => state.updateKeyboard);
  const setKeyboardCell = useBuilder((state) => state.setKeyboardCell);
  const addKeyboardRow = useBuilder((state) => state.addKeyboardRow);
  const removeKeyboardRow = useBuilder((state) => state.removeKeyboardRow);
  const addKeyboardButton = useBuilder((state) => state.addKeyboardButton);

  const bothEnabled =
    node.keyboard.enabled &&
    node.response.inlineKeyboard.enabled &&
    node.response.inlineKeyboard.rows.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="pr-4">
          <Label htmlFor="reply-keyboard-enabled" className="text-sm">
            Reply keyboard
          </Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Persistent buttons beneath the chat input. Tapping one sends its label as a normal
            message.
          </p>
        </div>
        <Switch
          id="reply-keyboard-enabled"
          checked={node.keyboard.enabled}
          onCheckedChange={(checked) => updateKeyboard(node.id, { enabled: checked })}
        />
      </div>

      {bothEnabled && (
        <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>
            Both keyboards are enabled. Telegram allows one <code className="rounded bg-muted px-1">reply_markup</code>{" "}
            per message, so the inline keyboard wins and this one is dropped.
          </span>
        </div>
      )}

      {node.keyboard.enabled && (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Grid3x3 className="size-3.5 text-muted-foreground" />
                Buttons
              </Label>
              <Button type="button" variant="outline" size="sm" onClick={() => addKeyboardRow(node.id)}>
                <Plus className="size-3.5" />
                Add row
              </Button>
            </div>

            <div className="space-y-2">
              {node.keyboard.rows.map((row, rowIndex) => (
                <div key={rowIndex} className="flex items-center gap-1.5">
                  <Badge variant="muted" className="shrink-0 font-mono text-[10px]">
                    R{rowIndex + 1}
                  </Badge>

                  {row.map((label, columnIndex) => (
                    <Input
                      key={columnIndex}
                      value={label}
                      onChange={(event) =>
                        setKeyboardCell(node.id, rowIndex, columnIndex, event.target.value)
                      }
                      placeholder="Label"
                      aria-label={`Row ${rowIndex + 1} button ${columnIndex + 1}`}
                      className="h-8 text-xs"
                    />
                  ))}

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => addKeyboardButton(node.id, rowIndex)}
                    aria-label={`Add button to row ${rowIndex + 1}`}
                    className="size-7 shrink-0"
                  >
                    <Plus className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeKeyboardRow(node.id, rowIndex)}
                    aria-label={`Remove row ${rowIndex + 1}`}
                    className="size-7 shrink-0 text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <ReplyKeyboardPreview rows={node.keyboard.rows} />

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <Label htmlFor="kb-resize" className="text-sm">
                  Fit to content
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Resize the keyboard to fit its buttons instead of stretching.
                </p>
              </div>
              <Switch
                id="kb-resize"
                checked={node.keyboard.resize}
                onCheckedChange={(checked) => updateKeyboard(node.id, { resize: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="pr-4">
                <Label htmlFor="kb-onetime" className="text-sm">
                  Hide after one use
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  The keyboard disappears once the user taps a button.
                </p>
              </div>
              <Switch
                id="kb-onetime"
                checked={node.keyboard.oneTime}
                onCheckedChange={(checked) => updateKeyboard(node.id, { oneTime: checked })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="kb-placeholder" className="text-sm">
                Input placeholder
              </Label>
              <Input
                id="kb-placeholder"
                value={node.keyboard.placeholder}
                onChange={(event) =>
                  updateKeyboard(node.id, { placeholder: event.target.value })
                }
                placeholder="e.g. Choose an option…"
                className="text-xs"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              These three options cannot be expressed in TeleBotHost&apos;s plain keyboard string, so
              changing any of them switches this command to sending raw{" "}
              <code className="rounded bg-muted px-1">reply_markup</code> from generated code.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function InlineKeyboardEditor({ node }: { node: CommandNode }) {
  const setInlineEnabled = useBuilder((state) => state.setInlineEnabled);
  const addInlineRow = useBuilder((state) => state.addInlineRow);
  const removeInlineRow = useBuilder((state) => state.removeInlineRow);
  const addInlineButton = useBuilder((state) => state.addInlineButton);
  const updateInlineButton = useBuilder((state) => state.updateInlineButton);
  const removeInlineButton = useBuilder((state) => state.removeInlineButton);

  const config = node.response.inlineKeyboard;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="pr-4">
          <Label htmlFor="inline-enabled" className="text-sm">
            Inline keyboard
          </Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Buttons attached to the message itself. Callback buttons route back into your commands;
            URL buttons open a link.
          </p>
        </div>
        <Switch
          id="inline-enabled"
          checked={config.enabled}
          onCheckedChange={(checked) => setInlineEnabled(node.id, checked)}
        />
      </div>

      {config.enabled && (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Rows</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => addInlineRow(node.id)}>
                <Plus className="size-3.5" />
                Add row
              </Button>
            </div>

            {config.rows.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                No buttons yet.
              </p>
            )}

            {config.rows.map((row, rowIndex) => (
              <div key={rowIndex} className="space-y-2 rounded-lg border p-2.5">
                <div className="flex items-center justify-between">
                  <Badge variant="muted" className="font-mono text-[10px]">
                    Row {rowIndex + 1}
                  </Badge>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => addInlineButton(node.id, rowIndex)}
                      aria-label={`Add button to row ${rowIndex + 1}`}
                      className="size-6"
                    >
                      <Plus className="size-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeInlineRow(node.id, rowIndex)}
                      aria-label={`Remove row ${rowIndex + 1}`}
                      className="size-6 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>

                {row.map((button) => (
                  <div key={button.id} className="flex items-center gap-1.5">
                    <Input
                      value={button.text}
                      onChange={(event) =>
                        updateInlineButton(node.id, rowIndex, button.id, {
                          text: event.target.value,
                        })
                      }
                      placeholder="Button label"
                      aria-label="Button label"
                      className="h-8 w-32 text-xs"
                    />

                    <Select
                      value={button.action}
                      onValueChange={(value) =>
                        updateInlineButton(node.id, rowIndex, button.id, {
                          action: value as "callback" | "url",
                        })
                      }
                    >
                      <SelectTrigger className="h-8 w-28 text-xs" aria-label="Button action">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="callback">
                          <Zap className="size-3" /> Callback
                        </SelectItem>
                        <SelectItem value="url">
                          <Link2 className="size-3" /> URL
                        </SelectItem>
                      </SelectContent>
                    </Select>

                    <Input
                      value={button.value}
                      onChange={(event) =>
                        updateInlineButton(node.id, rowIndex, button.id, {
                          value: event.target.value,
                        })
                      }
                      placeholder={button.action === "url" ? "https://…" : "callback_data"}
                      aria-label="Button value"
                      className="h-8 flex-1 font-mono text-xs"
                    />

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeInlineButton(node.id, rowIndex, button.id)}
                      aria-label="Remove button"
                      className="size-7 shrink-0 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <InlineKeyboardPreview node={node} />

          <p className="flex gap-1.5 text-xs text-muted-foreground">
            <CornerDownLeft className="mt-0.5 size-3.5 shrink-0" />
            A callback button whose value matches another command&apos;s trigger (or its{" "}
            <em>Inline button callback</em> trigger) will run that command when tapped.
          </p>
        </>
      )}
    </div>
  );
}

export function KeyboardPanel({ node }: { node: CommandNode }) {
  return (
    <div className="space-y-6">
      <ReplyKeyboardEditor node={node} />
      <Separator />
      <InlineKeyboardEditor node={node} />
    </div>
  );
}
