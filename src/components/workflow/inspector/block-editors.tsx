"use client";

import * as React from "react";
import { Braces, GitBranch, Globe, Keyboard as KeyboardIcon, MessageSquare, Plus, Trash2, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  FIELD_VALIDATOR_META_LABEL,
  HTTP_METHODS,
  KEYBOARD_TYPE_LABEL,
  MEDIA_KIND_LABEL,
  METHODS_WITH_BODY,
  OPERATOR_LABEL,
  SUBJECT_LABEL,
  TRIGGER_KIND_HINT,
  TRIGGER_KIND_LABEL,
  UNARY_OPERATORS,
} from "@/lib/workflow-labels";
import { createWorkflowId } from "@/types/workflow";
import type {
  ApiBlockData,
  ConditionBlockData,
  ConditionOperator,
  ConditionSubject,
  HttpMethod,
  KeyboardBlockData,
  KeyboardType,
  MediaKind,
  MessageBlockData,
  StateBlockData,
  StateValidator,
  TblParseMode,
  TriggerBlockData,
  TriggerKind,
  ValidationIssue,
  WorkflowNodeData,
} from "@/types/workflow";
import { Field, InspectorSection, TagInput, ToggleRow } from "./fields";

/** Issues attached to one field of the current block. */
function fieldIssues(issues: ValidationIssue[], field: string): ValidationIssue[] {
  return issues.filter((issue) => issue.field === field);
}

type EditorProps<T> = {
  data: T;
  issues: ValidationIssue[];
  update: (patch: Partial<WorkflowNodeData>) => void;
};

const PARSE_MODES: TblParseMode[] = ["Markdown", "MarkdownV2", "HTML"];

// ---------------------------------------------------------------------------
// 1. Trigger
// ---------------------------------------------------------------------------

const TRIGGER_KINDS: TriggerKind[] = [
  "command",
  "keyword",
  "regex",
  "wildcard",
  "callback",
  "inline",
];

const TRIGGER_PLACEHOLDER: Record<TriggerKind, string> = {
  command: "/start",
  keyword: "Help",
  regex: "^order\\s+(\\d+)$",
  wildcard: "*",
  callback: "confirm",
  inline: "search",
};

export function TriggerEditor({ data, issues, update }: EditorProps<TriggerBlockData>) {
  return (
    <>
      <InspectorSection title="Trigger" description="How this command is entered.">
        <Field label="Type" htmlFor="trigger-kind" hint={TRIGGER_KIND_HINT[data.triggerKind]}>
          <Select
            value={data.triggerKind}
            onValueChange={(value) => {
              const kind = value as TriggerKind;
              // Reset the value: carrying "/start" into a regex field would be invalid.
              update({ triggerKind: kind, value: kind === "wildcard" ? "*" : "" });
            }}
          >
            <SelectTrigger id="trigger-kind" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRIGGER_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {TRIGGER_KIND_LABEL[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label={data.triggerKind === "regex" ? "Pattern" : "Match value"}
          htmlFor="trigger-value"
          issues={fieldIssues(issues, "value")}
          hint={
            data.triggerKind === "regex"
              ? "TBL has no regex routing, so this is tested inside the shared * fallback command."
              : undefined
          }
        >
          <Input
            id="trigger-value"
            value={data.value}
            onChange={(event) => update({ value: event.target.value })}
            placeholder={TRIGGER_PLACEHOLDER[data.triggerKind]}
            disabled={data.triggerKind === "wildcard"}
            spellCheck={false}
            className="h-8 font-mono text-xs"
          />
        </Field>

        <Field label="Aliases" htmlFor="trigger-aliases" hint="Extra triggers for this command. Aliases are case-sensitive.">
          <TagInput
            id="trigger-aliases"
            values={data.aliases}
            onChange={(aliases) => update({ aliases })}
            placeholder="Type an alias and press Enter"
          />
        </Field>
      </InspectorSection>

      <InspectorSection title="Matching">
        <ToggleRow
          id="trigger-case"
          label="Ignore case"
          description="Match regardless of capitalisation."
          checked={data.caseInsensitive}
          onChange={(caseInsensitive) => update({ caseInsensitive })}
        />
        <ToggleRow
          id="trigger-group"
          label="Group chats only"
          description="Ignore this command in private chats."
          checked={data.groupOnly}
          onChange={(groupOnly) => update({ groupOnly })}
        />
      </InspectorSection>
    </>
  );
}

// ---------------------------------------------------------------------------
// 2. Message
// ---------------------------------------------------------------------------

const MEDIA_KINDS: MediaKind[] = ["photo", "document", "video", "audio"];

export function MessageEditor({ data, issues, update }: EditorProps<MessageBlockData>) {
  const media = data.media;

  function patchMedia(id: string, patch: Partial<MessageBlockData["media"][number]>) {
    update({ media: media.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  }

  return (
    <>
      <InspectorSection
        title="Message body"
        description="Use {{variable}} to interpolate a value captured earlier."
      >
        <Field
          label={`Text (${data.text.length.toLocaleString()} / 10,000)`}
          htmlFor="message-text"
          issues={fieldIssues(issues, "text")}
        >
          <Textarea
            id="message-text"
            value={data.text}
            onChange={(event) => update({ text: event.target.value })}
            placeholder={"Hello {{user.first_name}}! 👋"}
            rows={6}
            className="font-mono text-xs"
          />
        </Field>

        <Field label="Formatting" htmlFor="message-parse-mode">
          <Select
            value={data.parseMode}
            onValueChange={(value) => update({ parseMode: value as TblParseMode })}
          >
            <SelectTrigger id="message-parse-mode" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PARSE_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {mode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </InspectorSection>

      <InspectorSection
        title="Attachments"
        description="Sent before the text, in this order."
        action={
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() =>
              update({
                media: [
                  ...media,
                  { id: createWorkflowId("media"), kind: "photo", source: "", caption: "" },
                ],
              })
            }
          >
            <Plus className="size-3" />
            Add
          </Button>
        }
      >
        {media.length === 0 && (
          <p className="rounded-md border border-dashed p-3 text-center text-[10px] text-muted-foreground">
            Text only.
          </p>
        )}

        {media.map((item, index) => (
          <div key={item.id} className="space-y-2 rounded-lg border p-2.5">
            <div className="flex items-center gap-1.5">
              <Select
                value={item.kind}
                onValueChange={(value) => patchMedia(item.id, { kind: value as MediaKind })}
              >
                <SelectTrigger className="h-7 w-[112px] text-[11px]" aria-label={`Attachment ${index + 1} kind`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEDIA_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {MEDIA_KIND_LABEL[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Badge variant="muted" className="ml-auto text-[9px]">
                #{index + 1}
              </Badge>

              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6 text-destructive hover:bg-destructive/10"
                aria-label="Remove attachment"
                onClick={() => update({ media: media.filter((entry) => entry.id !== item.id) })}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>

            <Input
              value={item.source}
              onChange={(event) => patchMedia(item.id, { source: event.target.value })}
              placeholder="https://example.com/image.png"
              aria-label="Media URL"
              className="h-7 font-mono text-[11px]"
            />
            <Input
              value={item.caption}
              onChange={(event) => patchMedia(item.id, { caption: event.target.value })}
              placeholder="Optional caption"
              aria-label="Caption"
              className="h-7 text-[11px]"
            />
          </div>
        ))}
      </InspectorSection>

      <InspectorSection title="Advanced">
        <Field
          label="Capture message id into"
          htmlFor="message-capture"
          hint="Stores the sent message so a later block can edit or delete it."
        >
          <Input
            id="message-capture"
            value={data.captureMessageId}
            onChange={(event) => update({ captureMessageId: event.target.value })}
            placeholder="welcomeMessageId"
            spellCheck={false}
            className="h-8 font-mono text-xs"
          />
        </Field>
      </InspectorSection>
    </>
  );
}

// ---------------------------------------------------------------------------
// 3. Keyboard
// ---------------------------------------------------------------------------

export function KeyboardEditor({ data, issues, update }: EditorProps<KeyboardBlockData>) {
  const rows = data.rows;

  function patchRow(rowIndex: number, next: KeyboardBlockData["rows"][number]) {
    update({ rows: rows.map((row, index) => (index === rowIndex ? next : row)) });
  }

  return (
    <>
      <InspectorSection title="Keyboard">
        <Field label="Type" htmlFor="keyboard-type">
          <Select
            value={data.keyboardType}
            onValueChange={(value) => update({ keyboardType: value as KeyboardType })}
          >
            <SelectTrigger id="keyboard-type" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KEYBOARD_TYPE_LABEL) as KeyboardType[]).map((type) => (
                <SelectItem key={type} value={type}>
                  {KEYBOARD_TYPE_LABEL[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Message text"
          htmlFor="keyboard-text"
          issues={fieldIssues(issues, "text")}
          hint="Telegram cannot send buttons without a message body, so this is required."
        >
          <Textarea
            id="keyboard-text"
            value={data.text}
            onChange={(event) => update({ text: event.target.value })}
            placeholder="Choose an option:"
            rows={3}
            className="text-xs"
          />
        </Field>

        <Field label="Formatting" htmlFor="keyboard-parse-mode">
          <Select
            value={data.parseMode}
            onValueChange={(value) => update({ parseMode: value as TblParseMode })}
          >
            <SelectTrigger id="keyboard-parse-mode" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PARSE_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {mode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </InspectorSection>

      <InspectorSection
        title="Buttons"
        description="Each row is one line of buttons."
        action={
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() =>
              update({
                rows: [
                  ...rows,
                  [{ id: createWorkflowId("btn"), text: "", action: "callback", value: "" }],
                ],
              })
            }
          >
            <Plus className="size-3" />
            Row
          </Button>
        }
      >
        {fieldIssues(issues, "rows").map((issue, index) => (
          <p key={index} className="text-[10px] text-destructive">
            {issue.message}
          </p>
        ))}

        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="space-y-2 rounded-lg border p-2.5">
            <div className="flex items-center gap-1.5">
              <Badge variant="muted" className="font-mono text-[9px]">
                Row {rowIndex + 1}
              </Badge>

              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto size-6"
                aria-label={`Add button to row ${rowIndex + 1}`}
                onClick={() =>
                  patchRow(rowIndex, [
                    ...row,
                    { id: createWorkflowId("btn"), text: "", action: "callback", value: "" },
                  ])
                }
              >
                <Plus className="size-3" />
              </Button>

              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6 text-destructive hover:bg-destructive/10"
                aria-label={`Remove row ${rowIndex + 1}`}
                onClick={() => update({ rows: rows.filter((_, index) => index !== rowIndex) })}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>

            {row.map((button) => (
              <div key={button.id} className="space-y-1.5 rounded border bg-muted/30 p-2">
                <div className="flex items-center gap-1.5">
                  <Input
                    value={button.text}
                    onChange={(event) =>
                      patchRow(
                        rowIndex,
                        row.map((entry) =>
                          entry.id === button.id ? { ...entry, text: event.target.value } : entry,
                        ),
                      )
                    }
                    placeholder="Label"
                    aria-label="Button label"
                    className="h-7 flex-1 text-[11px]"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6 text-destructive hover:bg-destructive/10"
                    aria-label="Remove button"
                    onClick={() =>
                      patchRow(
                        rowIndex,
                        row.filter((entry) => entry.id !== button.id),
                      )
                    }
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>

                <div className="flex items-center gap-1.5">
                  <Select
                    value={button.action}
                    onValueChange={(value) =>
                      patchRow(
                        rowIndex,
                        row.map((entry) =>
                          entry.id === button.id
                            ? { ...entry, action: value as typeof entry.action }
                            : entry,
                        ),
                      )
                    }
                  >
                    <SelectTrigger className="h-7 w-[104px] text-[11px]" aria-label="Button action">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="callback">Callback</SelectItem>
                      <SelectItem value="url">URL</SelectItem>
                      <SelectItem value="webapp">Web App</SelectItem>
                    </SelectContent>
                  </Select>

                  <Input
                    value={button.value}
                    onChange={(event) =>
                      patchRow(
                        rowIndex,
                        row.map((entry) =>
                          entry.id === button.id ? { ...entry, value: event.target.value } : entry,
                        ),
                      )
                    }
                    placeholder={
                      button.action === "callback" ? "callback_data" : "https://…"
                    }
                    aria-label="Button value"
                    className="h-7 flex-1 font-mono text-[11px]"
                  />
                </div>
              </div>
            ))}
          </div>
        ))}
      </InspectorSection>

      {data.keyboardType === "reply" && (
        <InspectorSection title="Reply keyboard options">
          <ToggleRow
            id="keyboard-resize"
            label="Fit to content"
            description="Resize the keyboard instead of stretching it."
            checked={data.resize}
            onChange={(resize) => update({ resize })}
          />
          <ToggleRow
            id="keyboard-onetime"
            label="Hide after one use"
            description="Dismiss the keyboard once a button is tapped."
            checked={data.oneTime}
            onChange={(oneTime) => update({ oneTime })}
          />
          <Field label="Input placeholder" htmlFor="keyboard-placeholder">
            <Input
              id="keyboard-placeholder"
              value={data.placeholder}
              onChange={(event) => update({ placeholder: event.target.value })}
              placeholder="Choose an option…"
              className="h-8 text-xs"
            />
          </Field>
        </InspectorSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 4. API fetch
// ---------------------------------------------------------------------------

export function ApiEditor({ data, issues, update }: EditorProps<ApiBlockData>) {
  const headers = data.headers;
  const carriesBody = METHODS_WITH_BODY.includes(data.method);

  function patchHeader(id: string, patch: Partial<ApiBlockData["headers"][number]>) {
    update({ headers: headers.map((header) => (header.id === id ? { ...header, ...patch } : header)) });
  }

  return (
    <>
      <InspectorSection title="Request">
        <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
          <Field label="Method" htmlFor="api-method">
            <Select
              value={data.method}
              onValueChange={(value) => update({ method: value as HttpMethod })}
            >
              <SelectTrigger id="api-method" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HTTP_METHODS.map((method) => (
                  <SelectItem key={method} value={method}>
                    {method}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Timeout (ms)" htmlFor="api-timeout" issues={fieldIssues(issues, "timeoutMs")}>
            <Input
              id="api-timeout"
              type="number"
              min={1000}
              max={60000}
              step={500}
              value={data.timeoutMs}
              onChange={(event) => update({ timeoutMs: Number(event.target.value) || 10_000 })}
              className="h-8 text-xs"
            />
          </Field>
        </div>

        <Field
          label="URL"
          htmlFor="api-url"
          issues={fieldIssues(issues, "url")}
          hint="Supports {{variable}} interpolation."
        >
          <Input
            id="api-url"
            value={data.url}
            onChange={(event) => update({ url: event.target.value })}
            placeholder="https://api.example.com/data"
            spellCheck={false}
            className="h-8 font-mono text-xs"
          />
        </Field>

        <Field
          label="Bind response to"
          htmlFor="api-bind"
          issues={fieldIssues(issues, "bindTo")}
          hint="Later blocks read it with {{name}} or {{name.field}}."
        >
          <Input
            id="api-bind"
            value={data.bindTo}
            onChange={(event) => update({ bindTo: event.target.value })}
            placeholder="apiResponse"
            spellCheck={false}
            className="h-8 font-mono text-xs"
          />
        </Field>
      </InspectorSection>

      <InspectorSection
        title="Headers"
        description="Mark a header secret to read it from TeleBotHost environment variables instead of inlining it."
        action={
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() =>
              update({
                headers: [
                  ...headers,
                  { id: createWorkflowId("hdr"), name: "", value: "", secret: false },
                ],
              })
            }
          >
            <Plus className="size-3" />
            Add
          </Button>
        }
      >
        {fieldIssues(issues, "headers").map((issue, index) => (
          <p key={index} className="text-[10px] text-destructive">
            {issue.message}
          </p>
        ))}

        {headers.length === 0 && (
          <p className="rounded-md border border-dashed p-3 text-center text-[10px] text-muted-foreground">
            No custom headers.
          </p>
        )}

        {headers.map((header) => (
          <div key={header.id} className="space-y-1.5 rounded-lg border p-2.5">
            <div className="flex items-center gap-1.5">
              <Input
                value={header.name}
                onChange={(event) =>
                  patchHeader(header.id, {
                    name: event.target.value,
                    // Auto-promote to an env read when the name looks like a credential.
                    secret: /key|token|secret|auth/i.test(event.target.value) ? true : header.secret,
                  })
                }
                placeholder="Authorization"
                aria-label="Header name"
                className="h-7 flex-1 font-mono text-[11px]"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6 text-destructive hover:bg-destructive/10"
                aria-label="Remove header"
                onClick={() => update({ headers: headers.filter((entry) => entry.id !== header.id) })}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>

            {header.secret ? (
              <p className="rounded bg-warning/10 px-2 py-1.5 font-mono text-[10px] text-warning">
                {`process.env.${header.name.replace(/[^A-Za-z0-9_]/g, "_") || "HEADER_NAME"}`}
              </p>
            ) : (
              <Input
                value={header.value}
                onChange={(event) => patchHeader(header.id, { value: event.target.value })}
                placeholder="Value"
                aria-label="Header value"
                className="h-7 font-mono text-[11px]"
              />
            )}

            <ToggleRow
              id={`header-secret-${header.id}`}
              label="Read from environment"
              description="Keeps the credential out of generated source."
              checked={header.secret}
              onChange={(secret) => patchHeader(header.id, { secret })}
            />
          </div>
        ))}
      </InspectorSection>

      {carriesBody && (
        <InspectorSection title="Request body" description="Must be valid JSON.">
          <Field label="JSON body" htmlFor="api-body" issues={fieldIssues(issues, "body")}>
            <Textarea
              id="api-body"
              value={data.body}
              onChange={(event) => update({ body: event.target.value })}
              placeholder={'{\n  "query": "{{message}}"\n}'}
              rows={5}
              className="font-mono text-xs"
            />
          </Field>
        </InspectorSection>
      )}

      <InspectorSection title="Failure handling">
        <Field label="Error message" htmlFor="api-error">
          <Textarea
            id="api-error"
            value={data.errorMessage}
            onChange={(event) => update({ errorMessage: event.target.value })}
            placeholder="Sorry, something went wrong while fetching that."
            rows={2}
            className="text-xs"
          />
        </Field>

        <ToggleRow
          id="api-halt"
          label="Stop the flow on failure"
          description="When off, later blocks run with the response variable set to null."
          checked={data.haltOnError}
          onChange={(haltOnError) => update({ haltOnError })}
        />
      </InspectorSection>
    </>
  );
}

// ---------------------------------------------------------------------------
// 5. Condition
// ---------------------------------------------------------------------------

const SUBJECTS: ConditionSubject[] = ["message", "params", "variable", "chatType"];
const OPERATORS: ConditionOperator[] = [
  "contains",
  "notContains",
  "equals",
  "startsWith",
  "endsWith",
  "matchesRegex",
  "isTruthy",
  "isEmpty",
  "greaterThan",
  "lessThan",
];

export function ConditionEditor({ data, issues, update }: EditorProps<ConditionBlockData>) {
  const isUnary = UNARY_OPERATORS.includes(data.operator);

  return (
    <>
      <InspectorSection title="Rule" description="Evaluated as a real if/else in the generated code.">
        <Field label="Check" htmlFor="condition-subject">
          <Select
            value={data.subject}
            onValueChange={(value) => update({ subject: value as ConditionSubject })}
          >
            <SelectTrigger id="condition-subject" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUBJECTS.map((subject) => (
                <SelectItem key={subject} value={subject}>
                  {SUBJECT_LABEL[subject]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {data.subject === "variable" && (
          <Field
            label="Variable name"
            htmlFor="condition-variable"
            issues={fieldIssues(issues, "variable")}
          >
            <Input
              id="condition-variable"
              value={data.variable}
              onChange={(event) => update({ variable: event.target.value })}
              placeholder="apiResponse.status"
              spellCheck={false}
              className="h-8 font-mono text-xs"
            />
          </Field>
        )}

        <Field label="Operator" htmlFor="condition-operator">
          <Select
            value={data.operator}
            onValueChange={(value) => update({ operator: value as ConditionOperator })}
          >
            <SelectTrigger id="condition-operator" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPERATORS.map((operator) => (
                <SelectItem key={operator} value={operator}>
                  {OPERATOR_LABEL[operator]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {!isUnary && (
          <Field
            label="Compare against"
            htmlFor="condition-value"
            issues={fieldIssues(issues, "compareValue")}
            hint="Supports {{variable}} interpolation."
          >
            <Input
              id="condition-value"
              value={data.compareValue}
              onChange={(event) => update({ compareValue: event.target.value })}
              placeholder="price"
              spellCheck={false}
              className="h-8 font-mono text-xs"
            />
          </Field>
        )}

        {!isUnary && (
          <ToggleRow
            id="condition-case"
            label="Ignore case"
            description="Lowercase both sides before comparing."
            checked={data.caseInsensitive}
            onChange={(caseInsensitive) => update({ caseInsensitive })}
          />
        )}
      </InspectorSection>

      <InspectorSection title="Branches">
        <div className="space-y-2 rounded-lg border p-2.5 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-success" />
            <span className="font-medium">true</span>
            <span className="ml-auto text-muted-foreground">right-top handle</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-destructive" />
            <span className="font-medium">false</span>
            <span className="ml-auto text-muted-foreground">right-bottom handle</span>
          </div>
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Each branch takes exactly one connection. Form-input blocks cannot be used inside a branch,
          because the branch would be re-evaluated on the next message.
        </p>
      </InspectorSection>
    </>
  );
}

// ---------------------------------------------------------------------------
// 6. State / form input
// ---------------------------------------------------------------------------

const VALIDATORS: StateValidator[] = ["none", "text", "email", "phone", "number", "url"];

export function StateEditor({ data, issues, update }: EditorProps<StateBlockData>) {
  return (
    <>
      <InspectorSection
        title="Form input"
        description="Sends a question, pauses the flow, then validates and stores the reply."
      >
        <Field label="Prompt" htmlFor="state-prompt" issues={fieldIssues(issues, "prompt")}>
          <Textarea
            id="state-prompt"
            value={data.prompt}
            onChange={(event) => update({ prompt: event.target.value })}
            placeholder="What's your email address?"
            rows={3}
            className="text-xs"
          />
        </Field>

        <Field
          label="Save answer as"
          htmlFor="state-variable"
          issues={fieldIssues(issues, "variable")}
          hint="Reference it later with {{variable}}."
        >
          <Input
            id="state-variable"
            value={data.variable}
            onChange={(event) => update({ variable: event.target.value })}
            placeholder="user_email"
            spellCheck={false}
            className="h-8 font-mono text-xs"
          />
        </Field>

        <Field label="Storage scope" htmlFor="state-scope">
          <Select
            value={data.scope}
            onValueChange={(value) => update({ scope: value as "user" | "bot" })}
          >
            <SelectTrigger id="state-scope" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">Per user (db.user)</SelectItem>
              <SelectItem value="bot">Shared across users (db.bot)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </InspectorSection>

      <InspectorSection title="Validation">
        <Field label="Accept" htmlFor="state-validator">
          <Select
            value={data.validator}
            onValueChange={(value) => update({ validator: value as StateValidator })}
          >
            <SelectTrigger id="state-validator" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VALIDATORS.map((validator) => (
                <SelectItem key={validator} value={validator}>
                  {FIELD_VALIDATOR_META_LABEL[validator]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <ToggleRow
          id="state-required"
          label="Required"
          description="Optional fields accept an empty reply."
          checked={data.required}
          onChange={(required) => update({ required })}
        />

        {data.validator !== "none" && (
          <Field label="Message when validation fails" htmlFor="state-error">
            <Input
              id="state-error"
              value={data.errorMessage}
              onChange={(event) => update({ errorMessage: event.target.value })}
              placeholder="That doesn't look right. Please try again."
              className="h-8 text-xs"
            />
          </Field>
        )}
      </InspectorSection>

      <InspectorSection title="After saving">
        <Field
          label="Confirmation message"
          htmlFor="state-confirm"
          hint="Optional. Leave empty to continue silently."
        >
          <Textarea
            id="state-confirm"
            value={data.confirmMessage}
            onChange={(event) => update({ confirmMessage: event.target.value })}
            placeholder="Got it, thanks!"
            rows={2}
            className="text-xs"
          />
        </Field>

        <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/5 p-2.5 text-[10px] leading-snug">
          <span>
            This block keeps the command&apos;s <code className="rounded bg-muted px-1">need_reply</code>{" "}
            session open. Give users a way out — a <code className="rounded bg-muted px-1">/start</code>{" "}
            command — and mention it in the prompt.
          </span>
        </div>
      </InspectorSection>
    </>
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export const BLOCK_ICON = {
  trigger: Zap,
  message: MessageSquare,
  keyboard: KeyboardIcon,
  api: Globe,
  condition: GitBranch,
  state: Braces,
} as const;

export function BlockEditor({
  data,
  issues,
  update,
}: {
  data: WorkflowNodeData;
  issues: ValidationIssue[];
  update: (patch: Partial<WorkflowNodeData>) => void;
}) {
  switch (data.kind) {
    case "trigger":
      return <TriggerEditor data={data} issues={issues} update={update} />;
    case "message":
      return <MessageEditor data={data} issues={issues} update={update} />;
    case "keyboard":
      return <KeyboardEditor data={data} issues={issues} update={update} />;
    case "api":
      return <ApiEditor data={data} issues={issues} update={update} />;
    case "condition":
      return <ConditionEditor data={data} issues={issues} update={update} />;
    case "state":
      return <StateEditor data={data} issues={issues} update={update} />;
    default:
      return null;
  }
}
