import { dirname, resolvePath } from "./paths";

export type LinkTarget =
  | { kind: "anchor"; id: string }
  | { kind: "external"; url: string }
  | { kind: "doc"; path: string; hash: string }
  | { kind: "file"; path: string };

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function fileUrlToPath(url: string): string {
  let p = decode(url.replace(/^file:\/\/(localhost)?/i, ""));
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  return p;
}

/**
 * Decides what clicking `href` inside the document at `docPath` should do.
 * `isViewable` tells which local files the app can show itself ("doc");
 * other local files are "file".
 */
export function classifyLink(href: string, docPath: string, isViewable: (path: string) => boolean): LinkTarget | null {
  href = href.trim();
  if (!href) return null;
  if (href.startsWith("#")) return { kind: "anchor", id: decode(href.slice(1)) };

  let path: string;
  let hash = "";
  const isDrive = /^[A-Za-z]:[\\/]/.test(href);
  if (!isDrive && /^[a-z][a-z0-9+.-]*:/i.test(href)) {
    if (!/^file:/i.test(href)) return { kind: "external", url: href };
    const [p, h = ""] = href.split("#", 2);
    path = fileUrlToPath(p);
    hash = decode(h);
  } else {
    const [pathAndQuery, h = ""] = href.split("#", 2);
    const pathPart = pathAndQuery.split("?", 1)[0];
    if (!pathPart) return h ? { kind: "anchor", id: decode(h) } : null;
    path = resolvePath(dirname(docPath), decode(pathPart));
    hash = decode(h);
  }
  return isViewable(path) ? { kind: "doc", path, hash } : { kind: "file", path };
}
