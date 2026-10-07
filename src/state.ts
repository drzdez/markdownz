import type { HistoryState } from "./history";
import type { PrintOptions } from "./print/imposition";
import type { DocExceptions } from "./print/orientation";
import type { RecentDoc } from "./recent";

export type ThemeSetting = "auto" | "light" | "dark";

/** An external application offered in the "Open with" menu. */
export interface OpenWithApp {
  name: string;
  /** Executable (path or name on PATH); on macOS an application name for `open -a` also works. */
  program: string;
  /** Arguments; "{file}" is replaced by the document path, which is appended when absent. */
  args?: string[];
  /** Extensions (without dot) the entry applies to; all documents when absent. */
  extensions?: string[];
}

/** User preferences, stored as `config.json` in the app config directory. */
export interface Config {
  theme: ThemeSetting;
  /** Markdown extension plugin id -> enabled. Missing ids fall back to the plugin default. */
  plugins: Record<string, boolean>;
  /** Document format id -> enabled. */
  formats: Record<string, boolean>;
  openWith: OpenWithApp[];
  /** Tables, code, diagrams and images wider than the text column may use the width of the window (default on). */
  wideObjects?: boolean;
  /** Width ruler above Markdown documents (default on). */
  ruler?: boolean;
  /** Your page orientation exceptions per document (full path), see print/orientation.ts. */
  pageExceptions?: Record<string, DocExceptions>;
  /** Text column and widest object in CSS px at 100 % zoom (set with the ruler). */
  widths?: { text: number; objects: number };
  /** Last used print settings. */
  print?: PrintOptions;
  /** Check for a new version once a day at start. */
  checkUpdates: boolean;
  /** Time of the last update check (ms since epoch). */
  lastUpdateCheck?: number;
  /** Version the user chose to skip. */
  skippedVersion?: string;
}

/** Open tabs etc., stored as `session.json`; restored on the next start. */
export interface Session {
  tabs: HistoryState[];
  active: number;
  zoom: number;
  toc: boolean;
  /** Recently closed tabs for Ctrl+Shift+T, newest last. */
  closed: HistoryState[];
  /** Recently opened documents, newest first. */
  recent: RecentDoc[];
  /** Indexes of the tabs shown side by side, left to right (one entry = a single document). */
  panes: number[];
  /** Relative widths of the panes. */
  paneSizes: number[];
  /** Indexes of the tabs shown as printed pages instead of continuous text. */
  pageTabs: number[];
  /** Sheets per row in page view; 0 = as many as fit. */
  pageColumns: number;
}

export const DEFAULT_CONFIG: Config = { theme: "auto", plugins: {}, formats: {}, openWith: [], checkUpdates: true };

export const DEFAULT_SESSION: Session = { tabs: [], active: 0, zoom: 1, toc: false, closed: [], recent: [], panes: [], paneSizes: [], pageTabs: [], pageColumns: 0 };
