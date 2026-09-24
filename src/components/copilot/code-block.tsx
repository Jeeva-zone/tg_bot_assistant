"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { TOKEN_CLASS, tokeniseJavaScript } from "@/lib/copilot/highlight";

/**
 * Renders TBL with syntax highlighting.
 *
 * The tokeniser itself lives in `lib/copilot/highlight.ts` — it is pure logic, and
 * keeping it out of a `"use client"` module lets the self-test route call it directly.
 */
export function CodeBlock({
  code,
  className,
  maxHeight,
}: {
  code: string;
  className?: string;
  /** Tailwind max-height class, e.g. `max-h-80`. */
  maxHeight?: string;
}) {
  const tokens = React.useMemo(() => tokeniseJavaScript(code), [code]);

  return (
    <pre
      className={cn(
        "code-block overflow-auto rounded-lg border bg-muted/40 p-3 text-[11px]",
        maxHeight,
        className,
      )}
    >
      <code>
        {tokens.map((token, index) => (
          <span key={index} className={TOKEN_CLASS[token.kind]}>
            {token.text}
          </span>
        ))}
      </code>
    </pre>
  );
}
