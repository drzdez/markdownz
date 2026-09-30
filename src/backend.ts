// Thin wrapper over the Tauri backend. When the page runs in a plain browser
// (`npm run dev` without Tauri) it falls back to fetch/localStorage so the
// renderer can be developed and tested quickly: open `/?file=/samples/demo.md`.

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const inTauri = "__TAURI_INTERNALS__" in window;

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

/** Canonical absolute path of an existing file; rejects when it does not exist. */
export async function resolvePath(path: string): Promise<string> {
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

/** Files passed on the command line / by the OS before the UI was ready. */
export async function takeStartupFiles(): Promise<string[]> {
  if (inTauri) return invoke<string[]>("take_startup_files");
  return new URLSearchParams(location.search).getAll("file");
}

/** Files opened later: second instance launch, macOS "open with". */
export function onOpenFiles(cb: (paths: string[]) => void): void {
  if (inTauri) void listen<string[]>("open-files", (e) => cb(e.payload));
}

export function onDocChanged(cb: (path: string) => void): void {
  if (inTauri) void listen<string>("doc-changed", (e) => cb(e.payload));
}

export function onDropFiles(cb: (paths: string[]) => void): void {
  if (!inTauri) return;
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

/** Non-markdown local links are only revealed in the file manager, never executed. */
export async function revealFile(path: string): Promise<void> {
  if (!inTauri) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

export async function pickFiles(filters: { name: string; extensions: string[] }[]): Promise<string[]> {
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

export async function printPage(): Promise<void> {
  if (inTauri) await invoke("print_page");
  else window.print();
}

export async function setWindowTitle(title: string): Promise<void> {
  document.title = title;
  if (inTauri) await getCurrentWindow().setTitle(title);
}

export async function showWindow(): Promise<void> {
  if (!inTauri) return;
  const win = getCurrentWindow();
  await win.show();
  await win.setFocus();
}

export async function closeWindow(): Promise<void> {
  if (inTauri) await getCurrentWindow().close();
}

/** Runs `cb` (e.g. persisting the session) before the window closes. */
export function onCloseRequested(cb: () => Promise<void>): void {
  if (inTauri) void getCurrentWindow().onCloseRequested(cb);
  else window.addEventListener("beforeunload", () => void cb());
}
