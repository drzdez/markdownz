// Orientation marks: a label where each marker sits in the file, a lock label
// where the print settings turn a page for wide content, your exceptions, and
// brackets in the left margin showing which blocks they affect. The same marks
// are drawn over the continuous view and over the page view; they are screen
// only, never part of the document, the find results or the printed pages.

import type { BlockInfo, MarkInfo, OrientationTarget, PageStart } from "../formats/types";
import type { Orientation } from "../print/imposition";
import type { BlockAnchor } from "../print/orientation";
import { el } from "./overlay";

/** What the user asked for on a mark; carried out by the app (file edits, your exceptions). */
export type MarkAction =
  /** Lines are 0-based lines of the file; `before` -1 means at the end. */
  | { type: "move"; line: number; before: number }
  | { type: "remove"; line: number }
  /** Removes several marker lines at once (e.g. a marker and the page break above it). */
  | { type: "remove-lines"; lines: number[] }
  | { type: "replace"; line: number; text: string }
  | { type: "insert"; before: number; text: string }
  | { type: "local"; anchor: BlockAnchor; label: string; orientation: Orientation | null }
  | { type: "reanchor"; from: BlockAnchor; to: BlockAnchor; label: string; orientation: Orientation }
  /** Your page break above a block: set or removed, or moved to another block. */
  | { type: "break"; anchor: BlockAnchor; label: string; on: boolean }
  | { type: "move-break"; from: BlockAnchor; to: BlockAnchor; label: string };

export interface MarksData {
  blocks: BlockInfo[];
  marks: MarkInfo[];
  turnable: boolean;
  pageStarts: PageStart[];
}

/** A line across the text where a page starts. */
export interface LineSpec {
  block: number;
  fraction: number;
  kind: string;
  label: LabelSpec | null;
}

/** The orientation menu target for a block (right click in the continuous view). */
export function blockTarget(data: MarksData, index: number): OrientationTarget | null {
  const b = data.blocks[index];
  if (!b) return null;
  const automatic: Orientation = b.rule ? "landscape" : "portrait";
  const how = b.decided ? (b.source === "yours" ? "your exception" : "marker in the file") : b.rule ? "wide content, print settings" : "print settings";
  return {
    anchor: b.anchor,
    line: b.line,
    label: b.label,
    effective: b.decided ?? automatic,
    reason: `${b.decided ?? automatic} · ${how}`,
    local: b.local,
    marker: b.marker,
    localBreak: b.localBreak,
    automatic,
    turnable: data.turnable,
  };
}

type Button = [string, string, MarkAction | null, boolean?];

/**
 * ⟳ on a page break written in the file (or a page start): turns the block the
 * page starts with, cycling landscape → portrait → automatic, by a marker in the file.
 */
function fileTurnButton(data: MarksData, block: number, now?: Orientation): Button {
  const b = data.blocks[block];
  if (!b || b.line < 0 || !data.turnable) return ["⟳", data.turnable ? "" : "Every page is landscape (print settings)", null];
  const m = data.marks.find((x) => x.before === block && x.line >= 0 && !x.moves && (x.value === "landscape" || x.value === "portrait"));
  // Without a marker the first click turns the page the other way round from how it is now.
  const current = now ?? b.decided ?? (b.rule ? "landscape" : "portrait");
  const to = current === "landscape" ? "portrait" : "landscape";
  if (!m) return ["⟳", `Turn this page ${to} (writes a ${to} marker above ${b.label})`, { type: "insert", before: b.line, text: `<!-- markdownz: ${to} -->` }];
  if (m.value === "landscape") return ["⟳", "Landscape (marker in the file); click for portrait", { type: "replace", line: m.line, text: "<!-- markdownz: portrait -->" }, true];
  return ["⟳", "Portrait (marker in the file); click to remove the marker (automatic)", { type: "remove", line: m.line }, true];
}

/** ⟳ on your page break: the same cycle with your exception (this computer only). */
function yourTurnButton(data: MarksData, block: number): Button {
  const b = data.blocks[block];
  if (!b || !data.turnable) return ["⟳", data.turnable ? "" : "Every page is landscape (print settings)", null];
  const next: Orientation | null = !b.local ? "landscape" : b.local === "landscape" ? "portrait" : null;
  const title = !b.local ? "Turn this page landscape (your exception)" : b.local === "landscape" ? "Landscape (your exception); click for portrait" : "Portrait (your exception); click for automatic";
  return ["⟳", title, { type: "local", anchor: b.anchor, label: b.label, orientation: next }, !!b.local];
}

/**
 * Lines where pages start (continuous view only; in the page view the sheets
 * show it). Page break markers and your page breaks have their own labels; a
 * page that simply runs full can be told to start before the block it splits.
 */
export function pageLines(data: MarksData): LineSpec[] {
  return data.pageStarts.map((p) => ({ block: p.block, fraction: p.fraction, kind: `pagebreak ${p.cause}`, label: pageTag(data, p) }));
}

/**
 * The grey tag of a page: ⟳ turns it (by a marker in the file), ⤒ starts it
 * above the block it would split. Pages started by a page break have that
 * label instead (null).
 */
export function pageTag(data: MarksData, p: PageStart): LabelSpec | null {
  if (p.cause === "marker" || p.cause === "yours") return null;
  const block = data.blocks[p.block];
  const split = p.fraction > 0.02 && block && block.line >= 0;
  const cause = { marker: "page break marker", yours: "your page break", turn: "the page turns", auto: "the page is full" }[p.cause];
  return {
    at: p.block,
    kind: "page",
    text: `page ${p.page}${p.landscape ? " · landscape" : ""}`,
    title: p.page === 1 ? "Page 1" : `Page ${p.page} starts here: ${cause}.${split ? ` It splits ${block.label}.` : ""}`,
    buttons: [
      ["⤒", split ? `Start page ${p.page} above ${block.label} instead (writes a page break marker)` : "", split ? { type: "insert", before: block.line, text: "<!-- markdownz: page break -->" } : null],
      fileTurnButton(data, p.block, p.landscape ? "landscape" : "portrait"),
    ],
  };
}

export interface BracketSpec {
  from: number;
  to: number;
  kind: string;
  lane: number;
  title: string;
}

export interface LabelSpec {
  /** The label sits at the top of this block (or below the last block when it equals the count). */
  at: number;
  kind: string;
  text: string;
  title: string;
  /** Symbol, tooltip, action (null = disabled) and whether the button shows a setting that is on. */
  buttons: Button[];
}

const swap = (o: Orientation): Orientation => (o === "landscape" ? "portrait" : "landscape");

/** Whether there is anything to show. */
export function hasMarks(data: MarksData | null): data is MarksData {
  return !!data && (data.marks.length > 0 || data.pageStarts.length > 0 || data.blocks.some((b) => b.rule || b.local || b.localBreak));
}

/** The brackets and labels for a document, independent of where they are drawn. */
export function markSpecs(data: MarksData): { brackets: BracketSpec[]; labels: LabelSpec[] } {
  const brackets: BracketSpec[] = [];
  const labels: LabelSpec[] = [];
  const lineOf = (before: number) => data.blocks[before]?.line ?? -1;

  data.blocks.forEach((b, i) => {
    if (b.local) brackets.push({ from: i, to: i, kind: `yours ${b.local}`, lane: 0, title: `${b.local}: your exception` });
    else if (b.marker) brackets.push({ from: i, to: i, kind: `marker ${b.marker}`, lane: 0, title: `${b.marker}: marker in the file` });
    if (b.rule && !b.decided && !b.moved) brackets.push({ from: i, to: i, kind: "rule", lane: 1, title: "landscape: wide content, print settings" });
    if (b.moved) brackets.push({ from: b.moved.from, to: b.moved.to, kind: "moved", lane: 1, title: `landscape: moved turn of ${b.label}` });
  });

  /** A page break marker right above block `i` (it then shows as ✂ on that block's label). */
  const breakAbove = (i: number) => data.marks.find((m) => m.value === "page break" && m.before === i && m.status === "ok" && m.line >= 0);
  const PAGE_BREAK = "<!-- markdownz: page break -->";
  /** The ✂ button: a page break marker above the block, written into the file or removed. */
  const breakButton = (block: number, insertBefore: number): [string, string, MarkAction | null, boolean] => {
    const existing = breakAbove(block);
    return existing
      ? ["✂︎", "Page break above: on (click to remove the page break marker from the file)", { type: "remove", line: existing.line }, true]
      : ["✂︎", "Start a new page here (writes a page break marker into the file)", insertBefore >= 0 ? { type: "insert", before: insertBefore, text: PAGE_BREAK } : null, false];
  };
  // Blocks whose label shows their page break, so it needs no label of its own.
  const labelled = new Set<number>([
    ...data.marks.filter((m) => m.line >= 0 && m.value !== "page break").map((m) => m.before),
    ...data.blocks.flatMap((b, i) => (b.rule ? [i] : [])),
  ]);

  // Markers in the file, at their place between blocks.
  for (const m of data.marks) {
    if (m.line < 0) continue;
    if (m.value === "page break" && m.status === "ok" && labelled.has(m.before)) continue;
    const title = `<!-- markdownz: ${m.value}${m.moves ? ` · moves rule of ${m.moves.tag} ${m.moves.hash}` : ""} -->\n${m.note}`;
    const turnable = !m.moves && m.value !== "page break";
    const flipped = turnable ? m.value.replace(/^(landscape|portrait)/, (o) => swap(o as Orientation)) : "";
    const rule = m.moves?.block ?? -1;
    // A moved turn stays on its side of the block it moves.
    const up = rule >= 0 && m.value === "landscape end" ? Math.max(m.before - 1, rule + 1) : m.before - 1;
    const down = rule >= 0 && m.value === "landscape start" ? Math.min(m.before + 1, rule) : m.before + 1;
    labels.push({
      at: m.before,
      kind: `${m.moves ? "moved" : "marker"} ${m.status}`,
      text: `${m.value === "page break" ? "✂︎" : "⟳"} ${m.value}${m.moves ? " · moved turn" : ""}${m.value !== "page break" && breakAbove(m.before) ? " · page break" : ""}${m.status === "ok" ? "" : ` · ${m.status}`}`,
      title,
      buttons: [
        ["↑", "Move up one block (edits this line of the file)", up >= 0 && up !== m.before ? { type: "move", line: m.line, before: lineOf(up) } : null],
        ["↓", "Move down one block", down >= 0 && down <= data.blocks.length && down !== m.before ? { type: "move", line: m.line, before: lineOf(down) } : null],
        // A single marker turns with ⟳ like everywhere else; a range end only swaps.
        ...(turnable && !m.value.includes(" ")
          ? [fileTurnButton(data, m.before)]
          : turnable
            ? [["⇄", `Change to ${flipped}`, { type: "replace", line: m.line, text: `<!-- markdownz: ${flipped} -->` }] as Button]
            : []),
        ...(m.value === "page break" ? [fileTurnButton(data, m.before)] : [breakButton(m.before, m.line)]),
        (() => {
          const pageBreak = m.value !== "page break" ? breakAbove(m.before) : undefined;
          return pageBreak
            ? (["✕", `Remove both: the ${m.value} marker and the page break`, { type: "remove-lines", lines: [m.line, pageBreak.line] }] as Button)
            : (["✕", "Remove the marker from the file", { type: "remove", line: m.line }] as Button);
        })(),
      ],
    });
  }

  // Turns made by the print settings: locked, but can be moved by a marker.
  data.blocks.forEach((b, i) => {
    if (!b.rule) return;
    const ref = `${b.anchor.tag} ${b.anchor.hash}`;
    const overruled = b.decided ? ` · overruled by ${b.source === "yours" ? "your exception" : "a marker"}` : "";
    const startShift = data.marks.find((m) => m.moves?.block === i && m.value === "landscape start" && m.status === "ok");
    const endShift = data.marks.find((m) => m.moves?.block === i && m.value === "landscape end" && m.status === "ok");
    const earlier = (b.moved?.from ?? i) - 1;
    const later = (b.moved?.to ?? i) + 2;
    labels.push({
      at: i,
      kind: `rule${b.moved ? " moved" : ""}`,
      text: `🔒 landscape · wide content${b.moved ? " · moved" : ""}${overruled}${breakAbove(i) ? " · page break" : ""}`,
      title: "The print settings turn this page (Wide tables). Moving the turn writes a marker into the file.",
      buttons: [
        [
          "⤒",
          "Turn one block earlier",
          earlier >= 0 && !b.decided
            ? startShift
              ? { type: "move", line: startShift.line, before: lineOf(earlier) }
              : { type: "insert", before: lineOf(earlier), text: `<!-- markdownz: landscape start · moves rule of ${ref} -->` }
            : null,
        ],
        [
          "⤓",
          "Turn back one block later",
          later <= data.blocks.length && !b.decided
            ? endShift
              ? { type: "move", line: endShift.line, before: lineOf(later) }
              : { type: "insert", before: lineOf(later), text: `<!-- markdownz: landscape end · moves rule of ${ref} -->` }
            : null,
        ],
        breakButton(i, b.line),
        fileTurnButton(data, i),
      ],
    });
  });

  // Your page breaks (this computer only); with an orientation exception they share its label.
  data.blocks.forEach((b, i) => {
    if (!b.localBreak || b.local) return;
    const to = (j: number): MarkAction | null =>
      j > 0 && j < data.blocks.length && !data.blocks[j].localBreak ? { type: "move-break", from: b.anchor, to: data.blocks[j].anchor, label: data.blocks[j].label } : null;
    labels.push({
      at: i,
      kind: "yours",
      text: "✂ page break · your exception",
      title: `Your page break above ${b.label}, saved on this computer.`,
      buttons: [
        ["↑", "Move it one block up", to(i - 1)],
        ["↓", "Move it one block down", to(i + 1)],
        yourTurnButton(data, i),
        ["✕", "Remove your page break", { type: "break", anchor: b.anchor, label: b.label, on: false }],
      ],
    });
  });

  // Your exceptions (this computer only): move them to another block or drop them.
  data.blocks.forEach((b, i) => {
    if (!b.local) return;
    const to = (j: number): MarkAction | null =>
      j >= 0 && j < data.blocks.length ? { type: "reanchor", from: b.anchor, to: data.blocks[j].anchor, label: data.blocks[j].label, orientation: b.local! } : null;
    labels.push({
      at: i,
      kind: "yours",
      text: `⟳ ${b.local} · your exception${b.localBreak ? " · page break" : ""}`,
      title: `Your exception for ${b.label}, saved on this computer; it wins over markers and settings.`,
      buttons: [
        ["↑", "Attach it to the block above", to(i - 1)],
        ["↓", "Attach it to the block below", to(i + 1)],
        ["⇄", `Change to ${swap(b.local)}`, { type: "local", anchor: b.anchor, label: b.label, orientation: swap(b.local) }],
        [
          "✂︎",
          b.localBreak ? "Page break above this block: on (click to turn off)" : "Start a new page above this block",
          { type: "break", anchor: b.anchor, label: b.label, on: !b.localBreak },
          b.localBreak,
        ],
        ["✕", "Remove your exception", { type: "local", anchor: b.anchor, label: b.label, orientation: null }],
      ],
    });
  });
  return { brackets, labels };
}

export function bracketElement(spec: BracketSpec, top: number, height: number, left: number): HTMLElement {
  const b = el("div", { className: `mdz-orient-bracket ${spec.kind}`, title: spec.title });
  Object.assign(b.style, { top: `${top}px`, height: `${height}px`, left: `${left}px` });
  return b;
}

export function labelElement(spec: LabelSpec, act: (action: MarkAction) => void): HTMLElement {
  const tag = el("div", { className: `mdz-orient-label ${spec.kind}`, title: spec.title }, el("span", { textContent: spec.text }));
  for (const [symbol, hint, action, on] of spec.buttons) {
    const button = el("button", { textContent: symbol, title: hint, disabled: !action, className: on ? "on" : "" });
    if (action) button.addEventListener("click", () => act(action));
    tag.append(button);
  }
  return tag;
}

/** Labels at the same place share a row; in the left margin when there is room, otherwise above the block. */
export class LabelRows {
  private rows = new Map<number, HTMLElement>();
  constructor(
    private parts: HTMLElement[],
    private marginRoom: number,
  ) {}

  add(label: HTMLElement, top: number, x: number): void {
    let row = this.rows.get(Math.round(top));
    if (!row) {
      const margin = x - 30 >= this.marginRoom;
      row = el("div", { className: `mdz-orient-row${margin ? " margin" : ""}` });
      Object.assign(row.style, { top: `${top}px`, left: `${margin ? x - 30 : x}px` });
      this.rows.set(Math.round(top), row);
      this.parts.push(row);
    }
    row.append(label);
  }
}

/** Marks over the continuous Markdown view. */
export class OrientationMarks {
  readonly element = el("div", { className: "mdz-orient-layer" });
  private data: MarksData | null = null;

  constructor(
    private view: HTMLElement,
    private act: (action: MarkAction) => void,
  ) {
    this.element.setAttribute("aria-hidden", "true");
  }

  get current(): MarksData | null {
    return this.data;
  }

  set(data: MarksData | null): void {
    this.data = data;
    this.layout();
  }

  /** Positions labels and brackets next to the blocks of the article (after any layout change). */
  layout(): void {
    const data = this.data;
    const article = this.view.querySelector<HTMLElement>(":scope > .markdown-body");
    if (!hasMarks(data) || !article) {
      this.element.replaceChildren();
      return;
    }
    const viewBox = this.view.getBoundingClientRect();
    const blocks = [...article.querySelectorAll<HTMLElement>(":scope > [data-mdz-block]")];
    const rect = (i: number) => blocks[i]?.getBoundingClientRect();
    const y = (r: DOMRect | undefined, edge: "top" | "bottom") => (r ? r[edge] - viewBox.top + this.view.scrollTop : 0);
    const text = article.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(article).paddingLeft) * (parseFloat(this.view.style.getPropertyValue("--zoom")) || 1);
    const left = text.left - viewBox.left + padding;
    /**
     * One column for all marks, so they line up: left of the text and of every block
     * (wide content may reach further left than the text).
     */
    let column = left;
    for (const block of blocks) column = Math.min(column, block.getBoundingClientRect().left - viewBox.left);
    const edge = () => column;
    const parts: HTMLElement[] = [];
    const { brackets, labels } = markSpecs(data);
    for (const b of brackets) {
      const top = y(rect(b.from), "top");
      const bottom = y(rect(b.to), "bottom");
      if (bottom > top) parts.push(bracketElement(b, top, bottom - top, edge() - 10 - b.lane * 7));
    }
    const rows = new LabelRows(parts, 220);
    const last = blocks.length - 1;
    for (const l of labels) {
      const top = l.at <= last ? y(rect(l.at), "top") : y(rect(last), "bottom");
      rows.add(labelElement(l, this.act), top, edge());
    }
    // Where pages start, across the text.
    const width = text.width - 2 * padding;
    for (const line of pageLines(data)) {
      const r = rect(line.block);
      if (!r) continue;
      const top = y(r, "top") + line.fraction * r.height;
      // Across the text and the block (a wide table reaches further than the text).
      const from = Math.min(left, r.left - viewBox.left);
      const to = Math.max(left + width, r.right - viewBox.left);
      const bar = el("div", { className: `mdz-orient-line ${line.kind}` });
      Object.assign(bar.style, { top: `${top}px`, left: `${from}px`, width: `${to - from}px` });
      parts.push(bar);
      if (line.label) {
        const tag = labelElement(line.label, this.act);
        // Right of the line when there is room, else left of it, else on it.
        const right = to + 8 + 150 <= this.view.clientWidth;
        const leftSide = !right && from >= 160;
        tag.classList.add("page-tag");
        if (leftSide) tag.classList.add("before");
        Object.assign(tag.style, { top: `${top}px`, left: `${right ? to + 8 : leftSide ? from - 8 : from}px` });
        parts.push(tag);
      }
    }
    this.element.replaceChildren(...parts);
    this.element.style.height = `${this.view.scrollHeight}px`;
  }
}
