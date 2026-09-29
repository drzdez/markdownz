// Minimal path helpers that work for both POSIX and Windows paths.
// The frontend never touches the file system directly; these only compute strings
// that the backend later canonicalizes.

const MARKDOWN_EXT = /\.(md|markdown|mdown|mkd|mkdn|mdwn|mdtxt|mdtext)$/i;

export function isMarkdownPath(p: string): boolean {
  return MARKDOWN_EXT.test(p);
}

export function isAbsolute(p: string): boolean {
  return /^([A-Za-z]:[\\/]|\\\\|\/)/.test(p);
}

function sepOf(p: string): string {
  if (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\")) return "\\";
  return p.includes("\\") && !p.includes("/") ? "\\" : "/";
}

export function basename(p: string): string {
  return p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (i < 0) return "";
  if (i === 0) return p[0];
  const dir = p.slice(0, i);
  // Keep the separator after a bare drive letter ("C:" -> "C:\").
  return /^[A-Za-z]:$/.test(dir) ? dir + p[i] : dir;
}

/** Resolves `rel` against directory `baseDir` and normalizes `.` and `..` segments. */
export function resolvePath(baseDir: string, rel: string): string {
  const sep = sepOf(baseDir || rel);
  const full = isAbsolute(rel) || !baseDir ? rel : baseDir + sep + rel;

  let prefix = "";
  let rest = full;
  const root = full.match(/^([A-Za-z]:)[\\/]|^\\\\([^\\/]+[\\/][^\\/]+)[\\/]?|^\//);
  if (root) {
    if (root[1]) prefix = root[1] + sep;
    else if (root[2]) prefix = "\\\\" + root[2].replace(/[\\/]/, sep) + sep;
    else prefix = "/";
    rest = full.slice(root[0].length);
  }

  const out: string[] = [];
  for (const part of rest.split(/[\\/]+/)) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!prefix) out.push("..");
    } else {
      out.push(part);
    }
  }
  return prefix + out.join(sep);
}

/** Case-insensitive on Windows-style paths, exact elsewhere. */
export function samePath(a: string, b: string): boolean {
  if (/^[A-Za-z]:[\\/]|^\\\\/.test(a)) {
    return a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase();
  }
  return a === b;
}
