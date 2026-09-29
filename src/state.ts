import type { HistoryState } from "./history";

export type ThemeSetting = "auto" | "light" | "dark";

/** User preferences, stored as `config.json` in the app config directory. */
export interface Config {
  theme: ThemeSetting;
  /** Plugin id -> enabled. Missing ids fall back to the plugin default. */
  plugins: Record<string, boolean>;
}

/** Open tabs etc., stored as `session.json`; restored on the next start. */
export interface Session {
  tabs: HistoryState[];
  active: number;
  zoom: number;
  toc: boolean;
  /** Recently closed tabs for Ctrl+Shift+T, newest last. */
  closed: HistoryState[];
}

export const DEFAULT_CONFIG: Config = { theme: "auto", plugins: {} };

export const DEFAULT_SESSION: Session = { tabs: [], active: 0, zoom: 1, toc: false, closed: [] };
