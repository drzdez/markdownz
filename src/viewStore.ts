// Your view settings of documents (orientation exceptions, page breaks, parts of
// Excel sheets, crop windows of PDF pages), kept on this computer and never in
// the documents themselves. One readable JSON file per document in the folder
// "views" of the app's config directory, named after the document plus a hash
// of its full path. The file names the document's path and a fingerprint of its
// content, so the settings follow a file that was moved or renamed.

import * as backend from "./backend";
import { basename } from "./paths";
import { hashText, type DocExceptions } from "./print/orientation";

export const VIEW_FILE_KIND = "markdownz view settings";

/** What a view settings file holds. */
export interface ViewFile extends DocExceptions {
  markdownz: typeof VIEW_FILE_KIND;
  version: 1;
  /** Full path of the document. */
  path: string;
  /** Size and content hash of the document when the settings were saved. */
  fingerprint?: string;
  /** `used` for people reading the file. */
  opened?: string;
}

/** The same key for the same file on Windows whatever the case or slashes. */
function pathKey(path: string): string {
  return /^[A-Za-z]:[\\/]|^\\\\/.test(path) ? path.replace(/\//g, "\\").toLowerCase() : path;
}

/** "Report.pdf-1a2b3c4d.json": readable, and unique per full path. */
export function viewFileName(path: string): string {
  const name = basename(path).replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/^\.+/, "").slice(0, 80) || "document";
  return `${name}-${hashText(pathKey(path))}.json`;
}

export function serializeViewFile(path: string, doc: DocExceptions, fingerprint?: string): string {
  const file: ViewFile = {
    markdownz: VIEW_FILE_KIND,
    version: 1,
    path,
    ...(fingerprint ? { fingerprint } : {}),
    used: doc.used,
    opened: new Date(doc.used).toISOString(),
    ...(doc.crop ? { crop: doc.crop } : {}),
    items: doc.items,
  };
  return JSON.stringify(file, null, 2);
}

export function parseViewFile(text: string): ViewFile | null {
  try {
    const file = JSON.parse(text) as Partial<ViewFile>;
    if (file.markdownz !== VIEW_FILE_KIND || typeof file.path !== "string" || !Array.isArray(file.items)) return null;
    return { ...file, used: typeof file.used === "number" ? file.used : 0 } as ViewFile;
  } catch {
    return null;
  }
}

/** The settings without what only the file adds, for comparing. */
function docKey(doc: DocExceptions): string {
  return JSON.stringify([doc.used, doc.crop ?? null, doc.items]);
}

export interface ViewIO {
  list(): Promise<string[]>;
  save(name: string, data: string): Promise<void>;
  remove(name: string): Promise<void>;
  fingerprint(path: string): Promise<string>;
}

const BACKEND_IO: ViewIO = {
  list: backend.viewList,
  save: backend.viewSave,
  remove: backend.viewRemove,
  fingerprint: backend.fileFingerprint,
};

export class ViewStore {
  /** What is on disk: file name -> settings key. */
  private saved = new Map<string, string>();
  private fingerprints = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private io: ViewIO = BACKEND_IO) {}

  /** Reads all view settings files; the newest wins when two name the same document. */
  async load(): Promise<Record<string, DocExceptions>> {
    const all: Record<string, DocExceptions> = {};
    const keys = new Map<string, string>();
    for (const text of await this.io.list().catch(() => [])) {
      const file = parseViewFile(text);
      if (!file) continue;
      const key = pathKey(file.path);
      const known = keys.get(key);
      if (known && all[known].used >= file.used) continue;
      if (known) delete all[known];
      keys.set(key, file.path);
      const doc: DocExceptions = { used: file.used, items: file.items, ...(file.crop ? { crop: file.crop } : {}) };
      all[file.path] = doc;
      this.saved.set(viewFileName(file.path), docKey(doc));
      if (file.fingerprint) this.fingerprints.set(key, file.fingerprint);
    }
    return all;
  }

  /** Writes the documents whose settings changed and removes the files of those that have none left; false when something failed. */
  sync(all: Record<string, DocExceptions>): Promise<boolean> {
    const run = async () => {
      let ok = true;
      const wanted = new Map<string, [string, DocExceptions]>();
      for (const [path, doc] of Object.entries(all)) if (doc.items.length || doc.crop) wanted.set(viewFileName(path), [path, doc]);
      for (const [name, [path, doc]] of wanted) {
        const key = docKey(doc);
        if (this.saved.get(name) === key) continue;
        const fingerprint = await this.io.fingerprint(path).catch(() => "");
        if (fingerprint) this.fingerprints.set(pathKey(path), fingerprint);
        try {
          await this.io.save(name, serializeViewFile(path, doc, fingerprint || this.fingerprints.get(pathKey(path))));
          this.saved.set(name, key);
        } catch (e) {
          ok = false;
          console.warn(`cannot save the view settings of ${path}`, e);
        }
      }
      for (const name of [...this.saved.keys()]) {
        if (wanted.has(name)) continue;
        await this.io.remove(name).catch((e) => console.warn(`cannot remove ${name}`, e));
        this.saved.delete(name);
      }
      return ok;
    };
    const done = this.queue.then(run, run);
    this.queue = done.then(() => {});
    return done;
  }

  /**
   * Settings saved for another path whose file has the same content as `path`
   * and no longer exists there: the document was moved or renamed.
   */
  async moved(path: string, all: Record<string, DocExceptions>, exists: (path: string) => Promise<boolean>): Promise<string | null> {
    if (all[path]) return null;
    const candidates = Object.keys(all).filter((p) => p !== path && this.fingerprints.has(pathKey(p)));
    if (!candidates.length) return null;
    const fingerprint = await this.io.fingerprint(path).catch(() => "");
    if (!fingerprint) return null;
    for (const old of candidates) {
      if (this.fingerprints.get(pathKey(old)) === fingerprint && !(await exists(old))) return old;
    }
    return null;
  }
}
