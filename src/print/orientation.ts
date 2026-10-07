// Page orientation exceptions for documents that reflow (Markdown).
//
// Priority, highest first:
//   1. your exception, stored on this computer per document (config)
//   2. a marker in the file: <!-- markdownz: landscape --> etc.
//   3. the print settings (Wide tables: landscape pages / shrink / as is)
// Exceptions belong to a block of content (a table, a paragraph), never to a
// page number, because pages move whenever the text or the settings change.
// Pure functions, unit tested; the DOM side lives in formats/markdown.ts.

import type { Orientation } from "./imposition";

export type MarkerValue = "landscape" | "portrait" | "landscape start" | "landscape end" | "portrait start" | "portrait end" | "page break";

const MARKERS = new Set<string>(["landscape", "portrait", "landscape start", "landscape end", "portrait start", "portrait end", "page break"]);

/** Comment text after "markdownz:", e.g. " Landscape  start " -> "landscape start"; null when unknown. */
export function parseMarker(text: string): MarkerValue | null {
  const value = text.trim().toLowerCase().replace(/\s+/g, " ").replace("pagebreak", "page break");
  return MARKERS.has(value) ? (value as MarkerValue) : null;
}

/** Marker comments in rendered HTML, replaced by invisible anchors that survive sanitizing. */
export function markersToAnchors(html: string): string {
  return html.replace(/<!--\s*markdownz\s*:([^>]*?)-->/gi, (comment, text: string) => {
    const value = parseMarker(text);
    return value ? `<span class="mdz-mark" data-mdz="${value}"></span>` : comment;
  });
}

/** One top-level item of a document in reading order: a marker or a block of content. */
export type Item = { mark: MarkerValue } | { block: true };

export interface MarkerResult {
  /** Orientation a marker asks for, per block index (undefined = none). */
  orientation: (Orientation | undefined)[];
  /** Blocks that must start on a new page. */
  breaks: Set<number>;
  /** Markers that apply to nothing (e.g. at the very end, or "end" without "start"). */
  unused: number;
}

/**
 * Applies markers to blocks: "landscape"/"portrait" to the next block,
 * "… start" to every block until "… end", "page break" before the next block.
 * A marker for the next block wins over a surrounding range.
 */
export function resolveMarkers(items: Item[]): MarkerResult {
  const orientation: (Orientation | undefined)[] = [];
  const breaks = new Set<number>();
  let next: Orientation | undefined;
  let range: Orientation | undefined;
  let pendingBreak = false;
  let unused = 0;
  for (const item of items) {
    if ("block" in item) {
      const index = orientation.length;
      orientation.push(next ?? range);
      if (pendingBreak) breaks.add(index);
      next = undefined;
      pendingBreak = false;
      continue;
    }
    const [value, edge] = item.mark.split(" ") as [string, string | undefined];
    if (item.mark === "page break") pendingBreak = true;
    else if (edge === "start") range = value as Orientation;
    else if (edge === "end") {
      if (range === value) range = undefined;
      else unused++;
    } else {
      if (next) unused++;
      next = value as Orientation;
    }
  }
  if (next) unused++;
  if (pendingBreak) unused++;
  return { orientation, breaks, unused };
}

/** Identifies a block of content across edits elsewhere in the document. */
export interface BlockAnchor {
  /** Element name, e.g. "table". */
  tag: string;
  /** Text of the nearest heading above the block. */
  heading: string;
  /** Hash of the start of the block's normalized text. */
  hash: string;
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** FNV-1a, 32 bit, as hex. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function makeAnchor(tag: string, heading: string, text: string): BlockAnchor {
  return { tag: tag.toLowerCase(), heading: normalizeText(heading).slice(0, 80), hash: hashText(normalizeText(text).slice(0, 300)) };
}

export function sameAnchor(a: BlockAnchor, b: BlockAnchor): boolean {
  return a.tag === b.tag && a.heading === b.heading && a.hash === b.hash;
}

/** Your exception for a block, kept in the app config. */
export interface LocalException {
  anchor: BlockAnchor;
  orientation: Orientation;
  /** Short description for menus, e.g. "table “Product | PG in master …”". */
  label: string;
}

/** Exceptions of one document, keyed by its full path in the config. */
export interface DocExceptions {
  /** Last time the document was opened (ms since epoch); old entries are removed. */
  used: number;
  items: LocalException[];
}

export const EXCEPTION_DAYS = 180;
export const MAX_EXCEPTION_DOCS = 500;

/** Drops documents not opened for EXCEPTION_DAYS and keeps the MAX_EXCEPTION_DOCS most recent. */
export function pruneExceptions(all: Record<string, DocExceptions>, now: number): Record<string, DocExceptions> {
  const limit = now - EXCEPTION_DAYS * 24 * 3600 * 1000;
  const kept = Object.entries(all)
    .filter(([, doc]) => doc.used >= limit && doc.items.length)
    .sort((a, b) => b[1].used - a[1].used)
    .slice(0, MAX_EXCEPTION_DOCS);
  return Object.fromEntries(kept);
}

export type Source = "yours" | "marker" | "settings";

export interface Decision {
  /** Forced orientation, or undefined to follow the print settings. */
  orientation: Orientation | undefined;
  source: Source;
  /** A lower-priority exception that is overruled, so the user can be told. */
  overrules?: { source: Source; orientation: Orientation };
}

/** Your exception wins over a marker in the file, which wins over the print settings. */
export function decide(local: Orientation | undefined, marker: Orientation | undefined): Decision {
  if (local) return { orientation: local, source: "yours", ...(marker && marker !== local ? { overrules: { source: "marker", orientation: marker } } : {}) };
  if (marker) return { orientation: marker, source: "marker" };
  return { orientation: undefined, source: "settings" };
}

export const SOURCE_TEXT: Record<Source, string> = {
  yours: "your exception",
  marker: "marker in the file",
  settings: "print settings",
};
