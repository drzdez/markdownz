// Document format plugins.
//
// A format plugin knows how to show one kind of file (Markdown, PDF, ...).
// The app around it (tabs, tree history, session, file watching, find bar,
// table of contents, zoom) is shared; each open document gets its own
// DocumentView created by the plugin that claims the file's extension.

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
  /** Custom printing; the app prints the visible view when absent. */
  print?(): Promise<void>;
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
