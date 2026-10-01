// Recently opened documents (pure helpers, unit tested).

import { samePath } from "./paths";

export interface RecentDoc {
  path: string;
  title?: string;
  /** Last time the document was shown, ms since epoch. */
  opened: number;
  /** The file no longer existed at the last check; kept in the list on purpose. */
  missing?: boolean;
}

export const MAX_RECENT = 100;

/** Moves `path` to the front (adding it when new) and keeps the list bounded. */
export function touchRecent(list: RecentDoc[], path: string, title: string | undefined, now: number): RecentDoc[] {
  const rest = list.filter((r) => !samePath(r.path, path));
  return [{ path, title, opened: now, missing: false }, ...rest].slice(0, MAX_RECENT);
}

/** Applies existence results for some paths; other entries are left as they are, none is dropped. */
export function markMissing(list: RecentDoc[], checked: Map<string, boolean>): RecentDoc[] {
  return list.map((r) => {
    const exists = [...checked].find(([path]) => samePath(path, r.path))?.[1];
    return exists === undefined ? r : { ...r, missing: !exists };
  });
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago" or a date. */
export function relativeTime(then: number, now: number): string {
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(then).toISOString().slice(0, 10);
}
