"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Database,
  ListOrdered,
  Plus,
  Trash2,
} from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { FIELD_VALIDATOR_META, type CommandNode, type FieldValidator } from "@/types/builder";
import { useBuilder } from "@/store/useBuilder";

export function FlowPanel({ node }: { node: CommandNode }) {
  const setFlowEnabled = useBuilder((state) => state.setFlowEnabled);
  const setFlowScope = useBuilder((state) => state.setFlowScope);
  const setFlowCompletion = useBuilder((state) => state.setFlowCompletion);
  const addFlowStep = useBuilder((state) => state.addFlowStep);
  const updateFlowStep = useBuilder((state) => state.updateFlowStep);
  const removeFlowStep = useBuilder((state) => state.removeFlowStep);
  const moveFlowStep = useBuilder((state) => state.moveFlowStep);

  const { flow } = node;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="pr-4">
          <Label htmlFor="flow-enabled" className="text-sm">
            Multi-step form
          </Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ask a series of questions, validating each answer before moving on. Answers are stored in
            TeleBotHost&apos;s built-in database.
          </p>
        </div>
        <Switch
          id="flow-enabled"
          checked={flow.enabled}
          onCheckedChange={(checked) => setFlowEnabled(node.id, checked)}
        />
      </div>

      {flow.enabled && (
        <>
          <div className="flex gap-2 rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs">
            <ListOrdered className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>
              This generates a state machine that runs on{" "}
              <code className="rounded bg-muted px-1">need_reply</code>. The command&apos;s Answer
              field is left empty on purpose — TBL re-sends it on every step, which would spam the
              user.
            </span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="flow-scope">Storage scope</Label>
            <Select
              value={flow.scope}
              onValueChange={(value) => setFlowScope(node.id, value as "user" | "bot")}
            >
              <SelectTrigger id="flow-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">Per user (db.user)</SelectItem>
                <SelectItem value="bot">Shared across all users (db.bot)</SelectItem>
              </SelectContent>
            </Select>
            <p className="flex gap-1.5 text-xs text-muted-foreground">
              <Database className="mt-0.5 size-3.5 shrink-0" />
              {flow.scope === "user"
                ? "Each user gets their own record — the right choice for profiles and contact details."
                : "One shared record — every user overwrites the previous answers."}
            </p>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Steps ({flow.steps.length})</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => addFlowStep(node.id)}>
                <Plus className="size-3.5" />
                Add step
              </Button>
            </div>

            {flow.steps.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                No steps yet. Add one to start collecting answers.
              </p>
            )}

            {flow.steps.map((step, index) => (
              <div key={step.id} className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
                    {index + 1}
                  </Badge>
                  <span className="text-xs font-medium">Step {index + 1}</span>

                  <div className="ml-auto flex gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => moveFlowStep(node.id, step.id, -1)}
                      disabled={index === 0}
                      aria-label="Move step up"
                      className="size-6"
                    >
                      <ArrowUp className="size-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => moveFlowStep(node.id, step.id, 1)}
                      disabled={index === flow.steps.length - 1}
                      aria-label="Move step down"
                      className="size-6"
                    >
                      <ArrowDown className="size-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeFlowStep(node.id, step.id)}
                      aria-label="Remove step"
                      className="size-6 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`prompt-${step.id}`} className="text-xs">
                    Prompt shown to the user
                  </Label>
                  <Textarea
                    id={`prompt-${step.id}`}
                    value={step.prompt}
                    onChange={(event) =>
                      updateFlowStep(node.id, step.id, { prompt: event.target.value })
                    }
                    placeholder={
                      index === 0 ? "What's your name?" : index === 1 ? "What's your email?" : "…"
                    }
                    rows={2}
                    className="text-sm"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`key-${step.id}`} className="text-xs">
                      Storage key
                    </Label>
                    <Input
                      id={`key-${step.id}`}
                      value={step.key}
                      onChange={(event) =>
                        updateFlowStep(node.id, step.id, { key: event.target.value })
                      }
                      placeholder="name"
                      spellCheck={false}
                      className="font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`validator-${step.id}`} className="text-xs">
                      Validate as
                    </Label>
                    <Select
                      value={step.validator}
                      onValueChange={(value) =>
                        updateFlowStep(node.id, step.id, {
                          validator: value as FieldValidator,
                        })
                      }
                    >
                      <SelectTrigger id={`validator-${step.id}`} className="h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(FIELD_VALIDATOR_META).map(([value, meta]) => (
                          <SelectItem key={value} value={value}>
                            {meta.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-md border p-2.5">
                  <div className="pr-3">
                    <Label htmlFor={`required-${step.id}`} className="text-xs">
                      Required
                    </Label>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Optional fields accept an empty reply.
                    </p>
                  </div>
                  <Switch
                    id={`required-${step.id}`}
                    checked={step.required}
                    onCheckedChange={(checked) =>
                      updateFlowStep(node.id, step.id, { required: checked })
                    }
                    className="scale-90"
                  />
                </div>

                {step.validator !== "none" && (
                  <div className="space-y-2">
                    <Label htmlFor={`error-${step.id}`} className="text-xs">
                      Message when validation fails
                    </Label>
                    <Input
                      id={`error-${step.id}`}
                      value={step.errorMessage}
                      onChange={(event) =>
                        updateFlowStep(node.id, step.id, { errorMessage: event.target.value })
                      }
                      placeholder="That doesn't look right. Please try again."
                      className="text-xs"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="flow-completion">Completion message</Label>
            <Textarea
              id="flow-completion"
              value={flow.completionMessage}
              onChange={(event) => setFlowCompletion(node.id, event.target.value)}
              placeholder="Thanks! Your details have been saved."
              rows={2}
              className="text-sm"
            />
          </div>

          <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/5 p-2.5 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            <span>
              TBL keeps the <code className="rounded bg-muted px-1">need_reply</code> session open
              after the last step, so the next plain message restarts the form. Give users a{" "}
              <code className="rounded bg-muted px-1">/start</code> or cancel command to escape, and
              mention it in your completion message.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
