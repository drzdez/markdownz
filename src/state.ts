import type { HistoryState } from "./history";
import type { PrintOptions } from "./print/imposition";
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
  /** Last used print settings. */
  print?: PrintOptions;
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
}

export const DEFAULT_CONFIG: Config = { theme: "auto", plugins: {}, formats: {}, openWith: [] };

export const DEFAULT_SESSION: Session = { tabs: [], active: 0, zoom: 1, toc: false, closed: [], recent: [] };
