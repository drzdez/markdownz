// Document format plugins.
//
// A format plugin knows how to show one kind of file (Markdown, PDF, ...).
// The app around it (tabs, tree history, session, file watching, find bar,
// table of contents, zoom) is shared; each open document gets its own
// DocumentView created by the plugin that claims the file's extension.

import type { Orientation, PageLayoutOptions } from "../print/imposition";
import type { BlockAnchor, LocalException } from "../print/orientation";
import type { Config } from "../state";

export interface ViewContext {
  theme: "light" | "dark";
  zoom: number;
}

/** Callbacks from a view back to the app. */
export interface ViewHost {
  /** Follows a link found in the document (resolved against the document path by the app). */
  followLink(href: string, newTab: boolean): void;
  /** The view scrolled; the app stores the position and syncs the table of contents. */
  onScroll(): void;
}

export interface OutlineItem {
  title: string;
  /** Nesting depth, 1 = top level. */
  level: number;
  /** Sort key comparable with DocumentView.position(); items without it are never highlighted. */
  position?: () => number;
  activate(): void;
}

export interface FindResult {
  /** Zero-based index of the current match, -1 when there is none. */
  index: number;
  count: number;
}

export interface FindProvider {
  /** Searches for `query`; `again` moves to the next/previous match of the same query. */
  find(query: string, direction: 1 | -1, again: boolean): void;
  clear(): void;
  /** Set by the find bar; providers report (possibly asynchronous) results through it. */
  onResult?: (result: FindResult) => void;
}

/** The block of content a page orientation exception for a page is attached to. */
export interface OrientationTarget {
  anchor: BlockAnchor;
  /** E.g. "table “Product | PG in master …”". */
  label: string;
  /** Orientation of the page now, and why. */
  effective: Orientation;
  reason: string;
  /** Your exception for the block, if any. */
  local?: Orientation;
  /** A marker in the file for the block, if any. */
  marker?: Orientation;
  /** What the print settings alone give. */
  automatic: Orientation;
  /** Whether a marker can change anything (false when every page is landscape anyway). */
  turnable: boolean;
}

/** Why the pages of a reflowing document have their orientation; shown in the page view and print dialog. */
export interface PageNotes {
  /** Short reason for a page, e.g. "landscape · marker in the file"; empty for ordinary pages. */
  page(index: number): string;
  /** What is in effect: settings, markers, your exceptions, and anything overruled or ignored. */
  summary: string[];
  /** Your exceptions that no longer match any block (the content changed). */
  orphans: LocalException[];
  target(index: number): OrientationTarget | null;
}

/** A document laid out as printable pages (Markdown is paginated, PDF has pages). */
export interface PrintPages {
  notes?: PageNotes;
  count: number;
  /** Page size in millimetres. */
  size(index: number): { width: number; height: number };
  /** A new element showing the page at its full size (called once per use). */
  render(index: number): HTMLElement;
  /** Releases resources (object URLs, measuring DOM). */
  dispose(): void;
}

export interface DocumentView {
  /** Scroll container shown inside the tab (must be absolutely positioned by CSS). */
  readonly element: HTMLElement;
  readonly find: FindProvider;
  /** Reads and shows the document; called again on reload. Resolves with the title if known. */
  load(path: string, ctx: ViewContext): Promise<{ title?: string }>;
  /** Re-renders after theme or settings changes; may reuse what `load` read. */
  refresh(ctx: ViewContext): Promise<void>;
  setZoom(zoom: number): void;
  /** Scrolls to an in-document target (`#fragment`); returns false when not found. */
  scrollToFragment(fragment: string): boolean;
  outline(): OutlineItem[];
  /** Current reading position in the same units as OutlineItem.position. */
  position(): number;
  /**
   * Lays the document out as pages for the print dialog; documents without it cannot be printed.
   * `layout` applies to documents that reflow (see `reflows`).
   */
  printPages?(paper: { width: number; height: number }, onProgress?: (done: number, total: number) => void, layout?: PageLayoutOptions): Promise<PrintPages>;
  /** The content is laid out for the paper (Markdown), unlike fixed pages (PDF). */
  readonly reflows?: boolean;
  dispose(): void;
}

export interface FormatPlugin {
  id: string;
  name: string;
  description: string;
  /** Lower-case file extensions without the dot. */
  extensions: string[];
  defaultEnabled: boolean;
  /** Applies changed settings to all views of this format (they are refreshed afterwards). */
  configure?(config: Config): void;
  createView(host: ViewHost): DocumentView;
}
