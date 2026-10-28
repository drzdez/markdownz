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

/** Writes `content` to an open document, only if it still contains `expected` (see edit_doc). */
export async function editDoc(path: string, expected: string, content: string): Promise<void> {
  if (inTauri) await invoke("edit_doc", { path, expected, content });
  else throw new Error("editing needs the app");
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

/** An application the system recommends for a file. */
export interface AssocApp {
  id: string;
  name: string;
}

/** Applications the system recommends for `path` ("Open with" in the file manager); Windows only. */
export async function openWithApps(path: string): Promise<AssocApp[]> {
  return inTauri ? invoke<AssocApp[]>("open_with_apps", { path }) : [];
}

/** Opens `path` in an application from `openWithApps`. */
export async function openWithApp(path: string, id: string): Promise<void> {
  if (inTauri) await invoke("open_with_app", { path, id });
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

/** Opens an existing folder in the default file manager. */
export async function openFolder(path: string): Promise<void> {
  if (inTauri) await invoke("open_folder", { path });
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

/** Copying the file itself to the clipboard works on Windows and macOS. */
export const canCopyFile = inTauri && (isMac || navigator.userAgent.includes("Windows"));

/** Puts the file on the clipboard, ready to paste into a folder or an e-mail. */
export async function copyFile(path: string): Promise<void> {
  await invoke("copy_file", { path });
}

/** The plugin index (plugins.json) as text. */
export async function pluginIndex(url: string): Promise<string> {
  if (inTauri) return invoke<string>("plugin_index", { url });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

/** Downloads a plugin, checks its signature and stores it with its index entry. */
export async function pluginInstall(manifest: object): Promise<void> {
  if (inTauri) await invoke("plugin_install", { manifest });
  else throw new Error("plugins need the app");
}

export async function pluginRemove(id: string): Promise<void> {
  if (inTauri) await invoke("plugin_remove", { id });
}

/** Index entries of the installed plugins. */
export async function pluginList<T>(): Promise<T[]> {
  return inTauri ? invoke<T[]>("plugin_list") : [];
}

/** Plugin ids chosen in the installer (Windows MSI); empty elsewhere. */
export async function installerPlugins(): Promise<string[]> {
  return inTauri ? invoke<string[]>("installer_plugins") : [];
}

/** Rejects with the reason when an installed plugin cannot be loaded (damaged, signature). */
export async function pluginCheck(id: string): Promise<void> {
  if (inTauri) await invoke("plugin_check", { id });
}

/** URL the installed plugin module is imported from (served after checking its signature). */
export function pluginModuleUrl(id: string): string {
  return convertFileSrc(`${id}.js`, "mdzplugin");
}

export interface AvailableUpdate {
  current: string;
  version: string;
  notes?: string;
  mode: "self" | "manual";
  install(onProgress: (fraction: number | null) => void): Promise<void>;
}

/** Asks the update endpoint for a newer version; null when up to date or outside Tauri. */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!inTauri) return null;
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

/** Contents of all view settings files (one per document, see viewStore.ts). */
export async function viewList(): Promise<string[]> {
  if (inTauri) return invoke<string[]>("view_list");
  return Object.keys(localStorage)
    .filter((k) => k.startsWith("mdz.views/"))
    .map((k) => localStorage.getItem(k) ?? "");
}

export async function viewSave(name: string, data: string): Promise<void> {
  if (inTauri) await invoke("view_save", { name, data });
  else localStorage.setItem(`mdz.views/${name}`, data);
}

export async function viewRemove(name: string): Promise<void> {
  if (inTauri) await invoke("view_remove", { name });
  else localStorage.removeItem(`mdz.views/${name}`);
}

/** Folder of the view settings files. */
export async function viewsFolder(): Promise<string> {
  return inTauri ? invoke<string>("views_folder") : "";
}

/** Size and content hash of a file, to recognize it after a move or rename. */
export async function fileFingerprint(path: string): Promise<string> {
  return inTauri ? invoke<string>("file_fingerprint", { path }) : "";
}

/** Writes a print project file (.mdzprint). */
export async function writeProject(path: string, content: string): Promise<void> {
  if (inTauri) await invoke("write_project", { path, content });
  else localStorage.setItem(`mdz.project/${path}`, content);
}

/** Asks where to save a new file; null when cancelled. */
export async function pickSaveFile(defaultPath: string, filters: { name: string; extensions: string[] }[]): Promise<string | null> {
  if (!inTauri) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath, filters });
}
