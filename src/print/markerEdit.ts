// Minimal edits of marker lines in a Markdown file: one line moves, appears or
// disappears; everything else (other lines, line endings) stays byte for byte.
// Pure functions, unit tested; Markdownz never changes anything but these lines.

const MARKER_LINE = /^\s*<!--\s*markdownz\s*:.*-->\s*$/i;

function edit(text: string, change: (lines: string[]) => void): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  change(lines);
  return lines.join(eol);
}

export function isMarkerLine(line: string): boolean {
  return MARKER_LINE.test(line);
}

/** Inserts `content` as a new line before line `before` (0-based; the line count appends). */
export function insertLine(text: string, before: number, content: string): string {
  return edit(text, (lines) => lines.splice(before, 0, content));
}

export function removeLine(text: string, line: number): string {
  return edit(text, (lines) => lines.splice(line, 1));
}

export function replaceLine(text: string, line: number, content: string): string {
  return edit(text, (lines) => lines.splice(line, 1, content));
}

/** Moves line `from` so it ends up right before the line that was `before` (original numbering). */
export function moveLine(text: string, from: number, before: number): string {
  return edit(text, (lines) => {
    const [line] = lines.splice(from, 1);
    lines.splice(before > from ? before - 1 : before, 0, line);
  });
}

/** True when the two versions differ only in marker lines (checked before writing a file). */
export function onlyMarkersChanged(before: string, after: string): boolean {
  const rest = (text: string) => text.split(/\r?\n/).filter((line) => !isMarkerLine(line));
  const a = rest(before);
  const b = rest(after);
  return a.length === b.length && a.every((line, i) => line === b[i]);
}
