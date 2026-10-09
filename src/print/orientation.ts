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

/**
 * A turn that the print settings make (a wide table gets a landscape page),
 * moved by a marker: "landscape start · moves rule of table a1b2c3d4" turns
 * already at the marker, "landscape end · …" only after it. The reference
 * names the block the rule belongs to (element and hash, as in BlockAnchor).
 */
export interface RuleRef {
  tag: string;
  hash: string;
}

export interface ParsedMarker {
  value: MarkerValue;
  moves?: RuleRef;
}

const MOVES = /^(.*?)\s*[·|]\s*moves rule of\s+([a-z0-9-]+)\s+([0-9a-f]{8})\s*$/i;

/** Comment text after "markdownz:", including a moved rule; null when unknown. */
export function parseMarkerText(text: string): ParsedMarker | null {
  const moved = text.match(MOVES);
  if (moved) {
    const value = parseMarker(moved[1]);
    if (value !== "landscape start" && value !== "landscape end") return null;
    return { value, moves: { tag: moved[2].toLowerCase(), hash: moved[3].toLowerCase() } };
  }
  const value = parseMarker(text);
  return value ? { value } : null;
}

/** The comment line for a marker, as written into a file. */
export function markerComment(marker: ParsedMarker): string {
  return `<!-- markdownz: ${marker.value}${marker.moves ? ` · moves rule of ${marker.moves.tag} ${marker.moves.hash}` : ""} -->`;
}

/** An invisible anchor for a marker that survives sanitizing; `line` is its line in the source. */
export function markerAnchor(marker: ParsedMarker, line?: number): string {
  const moves = marker.moves ? ` data-moves="${marker.moves.tag} ${marker.moves.hash}"` : "";
  return `<span class="mdz-mark" data-mdz="${marker.value}"${moves}${line === undefined ? "" : ` data-line="${line}"`}></span>`;
}

/** Marker comments left in rendered HTML (e.g. inside a paragraph), replaced by anchors. */
export function markersToAnchors(html: string): string {
  return html.replace(/<!--\s*markdownz\s*:([^>]*?)-->/gi, (comment, text: string) => {
    const marker = parseMarkerText(text);
    return marker ? markerAnchor(marker) : comment;
  });
}

/** One top-level item of a document in reading order: a marker or a block of content. */
export type Item = { mark: MarkerValue; moves?: RuleRef } | { block: true };

export interface MarkerResult {
  /** Orientation a marker asks for, per block index (undefined = none). */
  orientation: (Orientation | undefined)[];
  /** Blocks that must start on a new page. */
  breaks: Set<number>;
  /** Markers that apply to nothing (e.g. at the very end, or "end" without "start"). */
  unused: number;
  /** Indexes (in the items) of those markers. */
  unusedItems: Set<number>;
  /** Moved rules, with the index of the block that follows the marker. */
  shifts: { item: number; value: "landscape start" | "landscape end"; moves: RuleRef; before: number }[];
}

/**
 * Applies markers to blocks: "landscape"/"portrait" to the next block,
 * "… start" to every block until "… end", "page break" before the next block.
 * A marker for the next block wins over a surrounding range.
 */
export function resolveMarkers(items: Item[]): MarkerResult {
  const orientation: (Orientation | undefined)[] = [];
  const breaks = new Set<number>();
  let next: { orientation: Orientation; item: number } | undefined;
  let range: { orientation: Orientation; item: number } | undefined;
  let pendingBreak: number | undefined;
  const unusedItems = new Set<number>();
  const shifts: MarkerResult["shifts"] = [];
  items.forEach((item, i) => {
    if ("block" in item) {
      const index = orientation.length;
      orientation.push(next?.orientation ?? range?.orientation);
      if (pendingBreak !== undefined) breaks.add(index);
      next = undefined;
      pendingBreak = undefined;
      return;
    }
    if (item.moves) {
      shifts.push({ item: i, value: item.mark as "landscape start" | "landscape end", moves: item.moves, before: orientation.length });
      return;
    }
    const [value, edge] = item.mark.split(" ") as [string, string | undefined];
    if (item.mark === "page break") pendingBreak = i;
    else if (edge === "start") range = { orientation: value as Orientation, item: i };
    else if (edge === "end") {
      if (range?.orientation === value) range = undefined;
      else unusedItems.add(i);
    } else {
      if (next) unusedItems.add(next.item);
      next = { orientation: value as Orientation, item: i };
    }
  });
  if (next) unusedItems.add(next.item);
  if (pendingBreak !== undefined) unusedItems.add(pendingBreak);
  return { orientation, breaks, unused: unusedItems.size, unusedItems, shifts };
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
  /** Orientation of the pages showing the block. */
  orientation?: Orientation;
  /** Instead of an orientation: a new page starts right above the block. */
  pageBreak?: boolean;
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
