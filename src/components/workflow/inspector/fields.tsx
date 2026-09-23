"use client";

import * as React from "react";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import type { ValidationIssue } from "@/types/workflow";

/**
 * Shared building blocks for the inspector.
 *
 * Every field renders its own validation message, so a problem is shown next to the
 * input that caused it rather than only in a summary list at the bottom.
 */

// ---------------------------------------------------------------------------
// Field wrapper
// ---------------------------------------------------------------------------

export function Field({
  label,
  htmlFor,
  hint,
  issues,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  /** Issues whose `field` matches this field. */
  issues?: ValidationIssue[];
  children: React.ReactNode;
  className?: string;
}) {
  const errors = (issues ?? []).filter((issue) => issue.severity === "error");
  const warnings = (issues ?? []).filter((issue) => issue.severity === "warning");

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>

      {children}

      {hint && !errors.length && (
        <p className="flex gap-1.5 text-[10px] leading-snug text-muted-foreground">
          <Info className="mt-px size-3 shrink-0" />
          <span>{hint}</span>
        </p>
      )}

      {errors.map((issue, index) => (
        <p key={`e${index}`} className="flex gap-1.5 text-[10px] leading-snug text-destructive">
          <AlertCircle className="mt-px size-3 shrink-0" />
          <span>{issue.message}</span>
        </p>
      ))}

      {warnings.map((issue, index) => (
        <p key={`w${index}`} className="flex gap-1.5 text-[10px] leading-snug text-warning">
          <AlertTriangle className="mt-px size-3 shrink-0" />
          <span>{issue.message}</span>
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue summary
// ---------------------------------------------------------------------------

export function IssueList({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) return null;

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  return (
    <div className="space-y-1.5">
      {[...errors, ...warnings].map((issue, index) => (
        <div
          key={index}
          className={cn(
            "flex gap-2 rounded-md border p-2 text-[11px] leading-snug",
            issue.severity === "error"
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : "border-warning/40 bg-warning/5 text-warning",
          )}
        >
          {issue.severity === "error" ? (
            <AlertCircle className="mt-px size-3 shrink-0" />
          ) : (
            <AlertTriangle className="mt-px size-3 shrink-0" />
          )}
          <span className="min-w-0">{issue.message}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small controls
// ---------------------------------------------------------------------------

/** A compact inline toggle with a label and description. */
export function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-2.5">
      <div className="pr-3">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        {description && (
          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{description}</p>
        )}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 shrink-0 accent-[var(--primary)] disabled:opacity-50"
      />
    </div>
  );
}

/** Section heading used to break the inspector into readable groups. */
export function InspectorSection({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {title}
          </h3>
          {description && (
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Tag-style editor for short string lists (aliases, headers names).
 * Enter commits, Backspace on an empty input removes the last entry.
 */
export function TagInput({
  id,
  values,
  onChange,
  placeholder,
}: {
  id?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = React.useState("");

  function commit() {
    const value = draft.trim();
    if (!value || values.includes(value)) {
      setDraft("");
      return;
    }
    onChange([...values, value]);
    setDraft("");
  }

  return (
    <div className="space-y-1.5">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]"
            >
              {value}
              <button
                type="button"
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((item) => item !== value))}
                className="text-muted-foreground hover:text-destructive"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        id={id}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Backspace" && draft === "" && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={commit}
        className="border-input focus-visible:border-ring focus-visible:ring-ring/40 h-8 w-full rounded-md border bg-transparent px-2.5 font-mono text-xs outline-none focus-visible:ring-[3px]"
      />
    </div>
  );
}
