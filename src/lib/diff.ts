/**
 * Line diff for the copilot's diff view.
 *
 * A standard LCS over lines. Scripts here are small (a few hundred lines at most),
 * so the O(n·m) table is not worth optimising away — and for that size it is both
 * faster and far more predictable than reaching for a Myers implementation.
 *
 * The table is also what lets us mark *modified* lines as remove+add pairs rather
 * than showing an opaque block, which is what makes the diff readable.
 */

export type DiffKind = "same" | "added" | "removed";

export interface DiffLine {
  kind: DiffKind;
  text: string;
  /** 1-based line number in the old text, when the line exists there. */
  oldLine?: number;
  /** 1-based line number in the new text, when the line exists there. */
  newLine?: number;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
  /** True when the two sides are identical. */
  identical: boolean;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  // Normalise CRLF so a Windows-saved script does not diff entirely.
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

/**
 * Compute a line-level diff between two scripts.
 *
 * @param oldText the existing command's code (may be empty for a new command)
 * @param newText the generated code
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const before = splitLines(oldText);
  const after = splitLines(newText);

  const n = before.length;
  const m = after.length;

  // LCS lengths. Table is (n+1) x (m+1).
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const row = table[i] as number[];
      const nextRow = table[i + 1] as number[];
      row[j] =
        before[i] === after[j]
          ? (nextRow[j + 1] as number) + 1
          : Math.max(nextRow[j] as number, row[j + 1] as number);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (before[i] === after[j]) {
      result.push({ kind: "same", text: before[i] as string, oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
      continue;
    }

    const down = (table[i + 1] as number[])[j] as number;
    const right = (table[i] as number[])[j + 1] as number;

    if (down >= right) {
      result.push({ kind: "removed", text: before[i] as string, oldLine: i + 1 });
      i += 1;
    } else {
      result.push({ kind: "added", text: after[j] as string, newLine: j + 1 });
      j += 1;
    }
  }

  while (i < n) {
    result.push({ kind: "removed", text: before[i] as string, oldLine: i + 1 });
    i += 1;
  }
  while (j < m) {
    result.push({ kind: "added", text: after[j] as string, newLine: j + 1 });
    j += 1;
  }

  return result;
}

export function summariseDiff(lines: DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const line of lines) {
    if (line.kind === "added") added += 1;
    else if (line.kind === "removed") removed += 1;
    else unchanged += 1;
  }

  return { added, removed, unchanged, identical: added === 0 && removed === 0 };
}

/**
 * Collapse runs of unchanged lines so a small change in a long script does not push
 * the real difference off screen.
 *
 * Returns the visible lines plus a marker for each elided run, so the UI can render
 * "… 42 unchanged lines …" instead of the whole block.
 */
export interface CollapsedDiff {
  items: (DiffLine | { kind: "gap"; count: number })[];
}

export function collapseUnchanged(lines: DiffLine[], contextLines = 3): CollapsedDiff {
  const items: CollapsedDiff["items"] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as DiffLine;

    if (line.kind !== "same") {
      items.push(line);
      index += 1;
      continue;
    }

    // Measure the run of unchanged lines.
    let end = index;
    while (end < lines.length && (lines[end] as DiffLine).kind === "same") end += 1;

    const runLength = end - index;

    // A run at the very start or end needs no leading/trailing context.
    const leading = index === 0 ? 0 : contextLines;
    const trailing = end === lines.length ? 0 : contextLines;

    if (runLength <= leading + trailing + 1) {
      // Too short to be worth collapsing.
      for (let k = index; k < end; k += 1) items.push(lines[k] as DiffLine);
    } else {
      for (let k = index; k < index + leading; k += 1) items.push(lines[k] as DiffLine);

      items.push({ kind: "gap", count: runLength - leading - trailing });

      for (let k = end - trailing; k < end; k += 1) items.push(lines[k] as DiffLine);
    }

    index = end;
  }

  return { items };
}
