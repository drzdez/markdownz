// Wide objects in the continuous Markdown view.
//
// Text stays in a readable column. Tables, code blocks, display math, diagrams
// and images that need more room than the column get just as much as they need
// so they do not have to scroll, up to the object width the user set with the
// ruler, and are centred in the view. Objects that fit are left alone.
// On paper (print, page view) the same objects get landscape pages or shrink.

import { groupColumns, type WideBlock } from "../print/paginate";
import type { WideTables } from "../print/imposition";

/** Widths in CSS px at 100 % zoom (they scale with the zoom like the text). */
export interface Widths {
  /** Width of the text column (content, without padding). */
  text: number;
  /** Widest an object may grow before it wraps or scales; never less than `text`. */
  objects: number;
}

/** The text column of earlier versions: 980 px including 48 px padding on each side. */
export const DEFAULT_TEXT_WIDTH = 884;
export const MIN_TEXT_WIDTH = 360;
/** Gap kept between a widened object and the edges of the view, px. */
export const VIEW_GAP = 16;

/**
 * Rigid objects can be laid out narrower by wrapping (tables) or not at all
 * (code, math) and scroll when they do not fit; scalable ones shrink.
 */
type Kind = "rigid" | "scalable";

interface WideObject {
  element: HTMLElement;
  kind: Kind;
}

function outsideTable(element: Element): boolean {
  return !element.parentElement?.closest("table");
}

/** Objects of the article that may be widened (not ones nested in a table). */
export function wideCandidates(article: HTMLElement): WideObject[] {
  const rigid = [...article.querySelectorAll<HTMLElement>("table, pre, .katex-display")].filter(
    (e) => outsideTable(e) && !e.parentElement?.closest("pre") && !e.closest(".mdz-diagram"),
  );
  const diagrams = [...article.querySelectorAll<HTMLElement>("figure.mdz-diagram")].filter(outsideTable);
  // Images standing alone in a paragraph (a picture, not an icon inside text).
  const images = [...article.querySelectorAll<HTMLImageElement>("p img")].filter(
    (img) => outsideTable(img) && img.closest("p")!.textContent!.trim() === "" && img.closest("p")!.querySelectorAll("img").length === 1,
  );
  return [...rigid.map((element) => ({ element, kind: "rigid" as Kind })), ...[...diagrams, ...images].map((element) => ({ element, kind: "scalable" as Kind }))];
}

/** Height / width of a diagram or image at its natural size (0 when unknown). */
function aspectRatio(element: HTMLElement): number {
  if (element instanceof HTMLImageElement) return element.naturalWidth ? element.naturalHeight / element.naturalWidth : 0;
  const svg = element.querySelector("svg");
  const box = svg?.viewBox.baseVal;
  if (box?.width) return box.height / box.width;
  const rect = svg?.getBoundingClientRect();
  return rect?.width ? rect.height / rect.width : 0;
}

/** Natural width of a diagram or image, in CSS px. */
function naturalWidth(element: HTMLElement): number {
  if (element instanceof HTMLImageElement) return element.naturalWidth;
  const svg = element.querySelector("svg");
  if (!svg) return 0;
  const max = parseFloat(svg.style.maxWidth);
  if (max) return max;
  const width = svg.width.baseVal;
  if (width.unitType !== SVGLength.SVG_LENGTHTYPE_PERCENTAGE && width.value) return width.value;
  return svg.viewBox.baseVal?.width ?? 0;
}

function reset(element: HTMLElement): void {
  element.classList.remove("mdz-wide");
  element.style.width = "";
  element.style.maxWidth = "";
  element.style.marginLeft = "";
  element.style.boxSizing = "";
}

/**
 * Lays out the wide objects of `article` shown in `view` at `zoom`. Reads and
 * writes are batched (a handful of layouts for the whole document), because
 * this runs on every resize of the view.
 */
export function fitWideObjects(article: HTMLElement, view: HTMLElement, zoom: number, widths: Widths | null): void {
  const objects = wideCandidates(article);
  objects.forEach((o) => reset(o.element));
  if (!widths || !objects.length) return;

  // Lengths inside the article are scaled by its zoom; measure in its units.
  const room = Math.max(0, (view.clientWidth - 2 * VIEW_GAP) / zoom);
  const limit = Math.max(widths.objects, widths.text);
  const { available, least, most } = measureObjects(objects, zoom);

  const targets = objects.map(({ element, kind }, i) => {
    const width =
      kind === "rigid"
        ? Math.min(room, Math.max(least[i], Math.min(most[i], limit))) // as narrow as possible without scrolling
        : Math.min(room, naturalWidth(element), limit);
    return width > available[i] + 1 ? width : 0;
  });
  objects.forEach(({ element }, i) => {
    if (!targets[i]) return;
    element.classList.add("mdz-wide");
    element.style.maxWidth = "none";
    element.style.width = `${targets[i]}px`;
  });
  // Centre in the view: shift each widened object from where it starts now. A margin, not a
  // transform: the view's scroll width follows the layout box and must not grow.
  const box = view.getBoundingClientRect();
  const centre = box.left + view.clientWidth / 2;
  const lefts = objects.map(({ element }, i) => (targets[i] ? element.getBoundingClientRect().left : 0));
  objects.forEach(({ element }, i) => {
    if (!targets[i]) return;
    const shift = (centre - (targets[i] * zoom) / 2 - lefts[i]) / zoom;
    element.style.marginLeft = `${shift}px`;
  });
}

/**
 * Width each object has in the text column (`available`), needs at least to
 * avoid scrolling (`least`, tables wrapped as much as possible) and would take
 * without wrapping (`most`), in the article's units. Three layouts in total.
 */
function measureObjects(objects: WideObject[], zoom: number): { available: number[]; least: number[]; most: number[] } {
  const measure = (width: string) => {
    for (const { element, kind } of objects) {
      // Widths include padding (code blocks), like the final widths set afterwards.
      element.style.boxSizing = "border-box";
      if (kind === "rigid" || width === "100%") element.style.width = width;
    }
    return objects.map(({ element }) => element.getBoundingClientRect().width / zoom);
  };
  const available = measure("100%");
  objects.forEach(({ element }) => (element.style.maxWidth = "none"));
  const least = measure("min-content");
  const most = measure("max-content");
  objects.forEach((o) => reset(o.element));
  return { available, least, most };
}

export interface PaperFit {
  /** How to handle an object: the print settings' Wide tables, or an orientation exception of its block. */
  modeFor(element: HTMLElement): WideTables;
  /** Room for wide objects on a landscape page, px. */
  landscapeRoom: number;
  /** Height of the text area of a portrait and of a landscape page, px (diagrams and images must fit it). */
  portraitHeight: number;
  landscapeHeight: number;
  /** Smallest text size in px a wide object may be scaled to. */
  minFontPx: number;
  /** Still too wide at the smallest size: split tables by columns and wrap code (true), or cut off. */
  split: boolean;
}

/** An object laid out wider than the text, for a landscape page. */
export interface PaperWide extends WideBlock {
  element: HTMLElement;
}

// Borders of collapsed tables add a little to the measured width.
const BORDER_SLACK = 2;

/**
 * Lays out tables, code and math wider than the text for paper, which cannot
 * scroll. In "landscape" mode they take up to the landscape room (extending to
 * the right of the text, which stays left aligned), in "shrink" mode the text
 * width. They are scaled down when still too wide, but never below the
 * smallest text size; table columns that still do not fit continue below in
 * further parts of the table (with the first column repeated), long code lines
 * wrap. Returns the objects that are wider than the text, so the pagination
 * can give them landscape pages.
 */
export function fitObjectsForPaper(article: HTMLElement, fit: PaperFit): { wide: PaperWide[]; overflowing: Set<HTMLElement> } {
  let objects = wideCandidates(article).filter((o) => o.kind === "rigid");
  let sizes = measureObjects(objects, 1);
  const roomFor = (element: HTMLElement, available: number) => (fit.modeFor(element) === "landscape" ? fit.landscapeRoom : available);
  // Split tables that cannot fit even at the smallest text size, then measure again.
  const split = objects.filter(({ element }, i) => {
    if (!fit.split || sizes.least[i] <= sizes.available[i] + 1 || element.tagName !== "TABLE" || fit.modeFor(element) === "none") return false;
    const scale = minScale(element, fit.minFontPx);
    const room = roomFor(element, sizes.available[i]);
    return sizes.least[i] * scale > room + 1 && splitTable(element as HTMLTableElement, room / scale);
  });
  if (split.length) {
    objects = wideCandidates(article).filter((o) => o.kind === "rigid");
    sizes = measureObjects(objects, 1);
  }
  const { available, least, most } = sizes;
  const wide: HTMLElement[] = [];
  /** Objects wider than the text, whatever is done with them. */
  const overflowing = new Set<HTMLElement>();
  objects.forEach(({ element }, i) => {
    if (least[i] <= available[i] + 1) return; // fits the text column
    overflowing.add(element);
    const mode = fit.modeFor(element);
    if (mode === "none") return; // as is
    const room = roomFor(element, available[i]);
    const style = element.style;
    Object.assign(style, { boxSizing: "border-box", maxWidth: "none", overflow: "visible" });
    if (least[i] <= room) {
      // Enough room once wider than the text: unwrap as far as the room allows.
      style.width = `${Math.min(most[i], room) + BORDER_SLACK}px`;
    } else {
      const scale = Math.max(room / (least[i] + BORDER_SLACK), minScale(element, fit.minFontPx));
      if (fit.split && element.tagName === "PRE" && (least[i] + BORDER_SLACK) * scale > room + 1) {
        // Code cannot shrink further: wrap the long lines (the code element inside sets white-space itself).
        Object.assign(style, { width: `${room / scale}px` });
        for (const e of [element, ...element.querySelectorAll<HTMLElement>("code")]) Object.assign(e.style, { whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
      } else style.width = `${least[i] + BORDER_SLACK}px`;
      style.zoom = String(scale);
    }
    if (mode === "landscape") wide.push(element);
  });
  // Diagrams and pictures scale freely, so they are never cut: wider than the text they get
  // a landscape page in landscape mode, and every one is kept within the height of its page.
  const pictures = wideCandidates(article).filter((o) => o.kind === "scalable");
  const textWidth = pictures.map(({ element }) => (element.parentElement ?? article).clientWidth);
  const natural = pictures.map(({ element }) => naturalWidth(element));
  const ratios = pictures.map(({ element }) => aspectRatio(element));
  pictures.forEach(({ element }, i) => {
    const turn = fit.modeFor(element) === "landscape" && natural[i] > textWidth[i] + 1;
    let width = turn ? Math.min(natural[i], fit.landscapeRoom) : Math.min(natural[i] || textWidth[i], textWidth[i]);
    // Room for the heading or caption that belongs to it on the same page.
    const height = (turn ? fit.landscapeHeight : fit.portraitHeight) * 0.85;
    if (ratios[i] && width * ratios[i] > height) width = height / ratios[i];
    if (!turn && width >= textWidth[i] - 1) return; // already as on screen: the text width
    Object.assign(element.style, { boxSizing: "border-box", maxWidth: "none", width: `${Math.floor(width)}px`, height: element instanceof HTMLImageElement ? "auto" : "" });
    // Figures have side margins in the paper styles; the width is measured from the text edge.
    if (element.tagName === "FIGURE") Object.assign(element.style, { marginLeft: "0", marginRight: "0" });
    if (turn && width > textWidth[i] + 1) wide.push(element);
  });
  const top = article.getBoundingClientRect().top;
  return {
    wide: wide
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0)
      .map(({ element, rect }) => ({ element, top: Math.floor(rect.top - top), bottom: Math.ceil(rect.bottom - top) })),
    overflowing,
  };
}

/** Smallest scale that keeps the object's text at `minFontPx`. */
function minScale(element: HTMLElement, minFontPx: number): number {
  const sample = element.querySelector("td, th, code") ?? element;
  const size = parseFloat(getComputedStyle(sample).fontSize) || 16;
  return Math.min(1, minFontPx / size);
}

/**
 * Replaces a table by several tables with groups of its columns that fit
 * `limit` px each, the first column repeated. Only simple tables (no merged
 * cells) are split; returns whether it did.
 */
function splitTable(table: HTMLTableElement, limit: number): boolean {
  if (table.querySelector("[colspan], [rowspan]")) return false;
  const first = table.rows[0];
  if (!first || first.cells.length < 3) return false;
  table.style.width = "min-content";
  table.style.maxWidth = "none";
  const widths = [...first.cells].map((cell) => cell.getBoundingClientRect().width);
  table.style.width = "";
  table.style.maxWidth = "";
  const groups = groupColumns(widths, limit);
  if (groups.length < 2) return false;
  const parts = groups.map((group, n) => {
    const part = table.cloneNode(true) as HTMLTableElement;
    const keep = new Set([0, ...group]);
    for (const row of [...part.rows]) [...row.cells].forEach((cell, i) => keep.has(i) || cell.remove());
    if (n === 0) return [part];
    const note = document.createElement("p");
    note.className = "mdz-table-continued";
    // Parts belong to the same block of content as the table (for orientation exceptions).
    if (table.dataset.mdzBlock) note.dataset.mdzBlock = table.dataset.mdzBlock;
    note.textContent = `Table continued (columns ${group[0] + 1}–${group[group.length - 1] + 1})`;
    return [note, part];
  });
  table.replaceWith(...parts.flat());
  return true;
}
