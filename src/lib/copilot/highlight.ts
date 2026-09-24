/**
 * A small, dependency-free JavaScript tokeniser for syntax highlighting.
 *
 * Lives in `lib` rather than beside the component that renders it, because it is pure
 * logic: the self-test route calls it directly, and a `"use client"` module cannot be
 * imported by a server route for anything other than rendering.
 *
 * Why hand-rolled rather than Prism or Shiki: Shiki ships a WASM grammar and a theme
 * per language (hundreds of KB); Prism is lighter but still a dependency with its own
 * stylesheet to reconcile against our theme tokens. TBL is plain JavaScript, so a
 * targeted tokeniser is a few dozen lines and inherits the app's colour variables for
 * free — dark mode included, which a bundled theme would not.
 *
 * It is a *highlighter*, not a parser: it never needs to be right about JavaScript
 * grammar, only about which spans should be coloured. The one invariant it must
 * uphold is that concatenating the tokens reproduces the input exactly.
 */

export type TokenKind =
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "global"
  | "method"
  | "punct"
  | "plain";

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = new Set([
  "const", "let", "var", "if", "else", "return", "await", "async", "function",
  "for", "while", "of", "in", "new", "try", "catch", "finally", "throw", "typeof",
  "instanceof", "null", "undefined", "true", "false", "break", "continue",
  "switch", "case", "default", "delete", "class", "this",
]);

/** TBL globals — highlighted distinctly so an invented one stands out. */
const GLOBALS = new Set([
  "Bot", "Api", "db", "user", "chat", "message", "params", "update",
  "update_type", "plan", "process", "env", "msg", "owner", "request", "options",
]);

const TOKEN_PATTERN = new RegExp(
  [
    // 1: comments
    String.raw`(\/\/[^\n]*|\/\*[\s\S]*?\*\/)`,
    // 2: strings — single, double and template
    String.raw`("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|` + "`(?:[^`\\\\]|\\\\.)*`" + `)`,
    // 3: numbers
    String.raw`(\b\d+(?:\.\d+)?\b)`,
    // 4: identifiers, classified afterwards
    String.raw`([A-Za-z_$][A-Za-z0-9_$]*)`,
    // 5: punctuation and operators
    String.raw`([{}()\[\];,.:=+\-*/<>!?&|~%^]+)`,
  ].join("|"),
  "g",
);

function classifyIdentifier(text: string, following: string): TokenKind {
  if (KEYWORDS.has(text)) return "keyword";
  if (GLOBALS.has(text)) return "global";
  // A `(` straight after means a call — colour it as a method.
  if (following.trimStart().startsWith("(")) return "method";
  return "plain";
}

export function tokeniseJavaScript(code: string): Token[] {
  if (code.length === 0) return [];

  const tokens: Token[] = [];
  let lastIndex = 0;

  TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_PATTERN.exec(code)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: "plain", text: code.slice(lastIndex, match.index) });
    }

    const [full, comment, string, number, identifier, punct] = match;

    if (comment !== undefined) tokens.push({ kind: "comment", text: comment });
    else if (string !== undefined) tokens.push({ kind: "string", text: string });
    else if (number !== undefined) tokens.push({ kind: "number", text: number });
    else if (identifier !== undefined) {
      const following = code.slice(match.index + full.length, match.index + full.length + 2);
      tokens.push({ kind: classifyIdentifier(identifier, following), text: identifier });
    } else if (punct !== undefined) tokens.push({ kind: "punct", text: punct });
    else tokens.push({ kind: "plain", text: full });

    lastIndex = match.index + full.length;
  }

  if (lastIndex < code.length) {
    tokens.push({ kind: "plain", text: code.slice(lastIndex) });
  }

  return tokens;
}

/** Tailwind classes per token kind, mapped onto the app's theme tokens. */
export const TOKEN_CLASS: Record<TokenKind, string> = {
  comment: "text-muted-foreground italic",
  string: "text-success",
  number: "text-chart-3",
  keyword: "text-chart-4",
  global: "text-primary font-medium",
  method: "text-chart-5",
  punct: "text-muted-foreground",
  plain: "",
};
