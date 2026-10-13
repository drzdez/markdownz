// Thin wrapper over the Tauri backend. When the page runs in a plain browser
// (`npm run dev` without Tauri) it falls back to fetch/localStorage so the
// renderer can be developed and tested quickly: open `/?file=/samples/demo.md`.
//
// On Android the Rust side is the same, but documents come in as content URIs
// that only the Kotlin side can read: MainActivity copies each one into the
// app's storage and exposes that through the `MarkdownzAndroid` JavaScript
// interface, so from here on a document is a path again.

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const inTauri = "__TAURI_INTERNALS__" in window;

/** The JavaScript interface of gen/android/.../MainActivity.kt. */
interface AndroidBridge {
  takeOpenFiles(): string;
  refreshDocument(path: string): string;
  writeBack(path: string): string;
  sourceUri(path: string): string;
  openWith(path: string): string;
  pickDocuments(): void;
  prune(keepJson: string): void;
  print(jobName: string): string;
  printFinished(): boolean;
}

const android = (window as { MarkdownzAndroid?: AndroidBridge }).MarkdownzAndroid ?? null;

/** Running as the Android app: no file manager, no window, documents arrive as intents. */
export const isAndroid = inTauri && android !== null;
/** Touch-first platforms where desktop-only features (file manager, updater) are hidden. */
export const isMobile = isAndroid;

export interface Doc {
  /** Canonical absolute path. */
  path: string;
  content: string;
}

export async function readDoc(path: string): Promise<Doc> {
  if (inTauri) return invoke<Doc>("read_doc", { path });
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return { path, content: await res.text() };
}

/** Writes `content` to an open document, only if it still contains `expected` (see edit_doc). */
export async function editDoc(path: string, expected: string, content: string): Promise<void> {
  if (!inTauri) throw new Error("editing needs the app");
  await invoke("edit_doc", { path, expected, content });
  if (android) {
    // The copy is changed; the original must follow or the edit is lost at the next refresh.
    const error = android.writeBack(path);
    if (error) throw new Error(`the original could not be written: ${error}`);
  }
}

/**
 * Canonical absolute path of an existing file; rejects when it does not exist.
 * On Android this also refreshes the local copy when the original changed.
 */
export async function resolvePath(path: string): Promise<string> {
  if (android) {
    const result = JSON.parse(android.refreshDocument(path)) as { path?: string; error?: string; stale?: boolean };
    if (!result.path) throw new Error(result.error ?? "cannot open the document");
    return result.path;
  }
  return inTauri ? invoke<string>("resolve_path", { path }) : path;
}

export async function readBinary(path: string): Promise<Uint8Array> {
  if (inTauri) return new Uint8Array(await invoke<ArrayBuffer>("read_binary", { path }));
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Opens `path` in another application: `program` with `args` ("{file}" = path),
 * or the system "choose an application" dialog when `program` is omitted.
 */
export async function openWith(path: string, program?: string, args?: string[]): Promise<void> {
  if (android) {
    const error = android.openWith(path);
    if (error) throw new Error(error);
    return;
  }
  if (inTauri) await invoke("open_with", { path, program: program ?? null, args: args ?? null });
}

export async function watchDocs(paths: string[]): Promise<void> {
  if (inTauri) await invoke("watch_docs", { paths });
}

export async function loadState<T>(name: string): Promise<T | null> {
  try {
    const raw = inTauri ? await invoke<string | null>("load_state", { name }) : localStorage.getItem(`mdz.${name}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (e) {
    console.warn(`cannot load ${name}`, e);
    return null;
  }
}

export async function saveState(name: string, value: unknown): Promise<void> {
  const data = JSON.stringify(value, null, 1);
  try {
    if (inTauri) await invoke("save_state", { name, data });
    else localStorage.setItem(`mdz.${name}`, data);
  } catch (e) {
    console.warn(`cannot save ${name}`, e);
  }
}

/** Android: drops the local copies of documents that are not in `keep` (open tabs, recent list). */
export function pruneDocuments(keep: string[]): void {
  android?.prune(JSON.stringify(keep));
}

/** Imports the documents Android handed over (intents, picker); reports those it could not read. */
function takeAndroidFiles(): string[] {
  if (!android) return [];
  const entries = JSON.parse(android.takeOpenFiles()) as { path?: string; error?: string }[];
  const errors = entries.filter((e) => !e.path).map((e) => e.error ?? "unknown document");
  if (errors.length) window.dispatchEvent(new CustomEvent("mdz-open-error", { detail: errors.join("\n") }));
  return entries.flatMap((e) => (e.path ? [e.path] : []));
}

/** Files passed on the command line / by the OS before the UI was ready. */
export async function takeStartupFiles(): Promise<string[]> {
  if (android) return takeAndroidFiles();
  if (inTauri) return invoke<string[]>("take_startup_files");
  return new URLSearchParams(location.search).getAll("file");
}

/** Files opened later: second instance launch, macOS "open with", Android intents and picker. */
export function onOpenFiles(cb: (paths: string[]) => void): void {
  if (android) {
    window.addEventListener("mdz-android-open", () => {
      const paths = takeAndroidFiles();
      if (paths.length) cb(paths);
    });
    return;
  }
  if (inTauri) void listen<string[]>("open-files", (e) => cb(e.payload));
}

/** Documents that could not be opened (Android: unreadable intents). */
export function onOpenError(cb: (message: string) => void): void {
  window.addEventListener("mdz-open-error", (e) => cb((e as CustomEvent<string>).detail));
}

export function onDocChanged(cb: (path: string) => void): void {
  if (inTauri) void listen<string>("doc-changed", (e) => cb(e.payload));
}

export function onDropFiles(cb: (paths: string[]) => void): void {
  if (!inTauri || isMobile) return;
  void getCurrentWebview().onDragDropEvent((e) => {
    if (e.payload.type === "drop") cb(e.payload.paths);
  });
}

export function fileSrc(path: string): string {
  return inTauri ? convertFileSrc(path) : path;
}

export async function openExternal(url: string): Promise<void> {
  if (!inTauri) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

/** Whether documents can be shown in a file manager (not on Android). */
export const canReveal = inTauri && !isMobile;

/** Opens an existing folder in the default file manager. */
export async function openFolder(path: string): Promise<void> {
  if (canReveal) await invoke("open_folder", { path });
}

/** Non-markdown local links are only revealed in the file manager, never executed. */
export async function revealFile(path: string): Promise<void> {
  if (!canReveal) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

/**
 * The system file dialog. On Android the document picker reports its choice
 * through `onOpenFiles` instead, so the result here is empty.
 */
export async function pickFiles(filters: { name: string; extensions: string[] }[]): Promise<string[]> {
  if (android) {
    android.pickDocuments();
    return [];
  }
  if (!inTauri) return [];
  const { open } = await import("@tauri-apps/plugin-dialog");
  return (await open({ multiple: true, directory: false, filters })) ?? [];
}

/** Lets the user pick an application bundle (macOS has no system "open with" chooser). */
export async function pickApplication(): Promise<string | null> {
  if (!inTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  return open({ directory: true, multiple: false, defaultPath: "/Applications", title: "Choose an application" });
}

export const isMac = navigator.userAgent.includes("Mac");

/**
 * The path as the user knows it: on Android the document behind the local copy
 * (the decoded last part of its content URI), elsewhere the path itself.
 */
export function displayPath(path: string): string {
  if (!android) return path;
  const uri = android.sourceUri(path);
  if (!uri) return path;
  const last = uri.slice(uri.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(last) || uri;
  } catch {
    return last || uri;
  }
}

export interface AvailableUpdate {
  current: string;
  version: string;
  notes?: string;
  mode: "self" | "manual";
  install(onProgress: (fraction: number | null) => void): Promise<void>;
}

/** Whether the app can look for new versions (desktop; Android gets a new APK). */
export const canCheckUpdates = inTauri && !isMobile;

/** Asks the update endpoint for a newer version; null when up to date or outside Tauri. */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!canCheckUpdates) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;
  const mode = await invoke<"self" | "manual">("update_mode");
  return {
    current: update.currentVersion,
    version: update.version,
    notes: update.body ?? undefined,
    mode,
    async install(onProgress) {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        else if (event.event === "Progress") done += event.data.chunkLength;
        onProgress(total ? Math.min(1, done / total) : null);
      });
      // On Windows the installer closes the app itself; elsewhere restart into the new version.
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
  };
}

/**
 * Hands the page to the system print dialog and resolves when it is closed.
 * Android prints asynchronously, so the prepared sheets are kept until the job
 * is over; `afterprint` is then raised by hand as the web view does not.
 */
export async function printPage(jobName = "Markdownz"): Promise<void> {
  if (android) {
    const error = android.print(jobName);
    if (error) throw new Error(error);
    await new Promise<void>((resolve) => {
      const poll = () => (android.printFinished() ? resolve() : setTimeout(poll, 500));
      setTimeout(poll, 1000);
    });
    window.dispatchEvent(new Event("afterprint"));
    return;
  }
  if (inTauri) await invoke("print_page");
  else window.print();
}

export async function setWindowTitle(title: string): Promise<void> {
  document.title = title;
  if (inTauri && !isMobile) await getCurrentWindow().setTitle(title);
}

export async function showWindow(): Promise<void> {
  if (!inTauri || isMobile) return;
  const win = getCurrentWindow();
  await win.show();
  await win.setFocus();
}

export async function closeWindow(): Promise<void> {
  if (inTauri && !isMobile) await getCurrentWindow().close();
}

/** Runs `cb` (e.g. persisting the session) before the window closes or the app goes to the background. */
export function onCloseRequested(cb: () => Promise<void>): void {
  if (isMobile) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void cb();
    });
  } else if (inTauri) void getCurrentWindow().onCloseRequested(cb);
  else window.addEventListener("beforeunload", () => void cb());
}
