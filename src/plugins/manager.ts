// Installed and available format plugins.
//
// The plugins of a release are listed in plugins.json next to its installers.
// Installed ones are registered as formats at start; their module is imported
// only when a file of theirs is opened.

import * as backend from "../backend";
import { createImageView } from "../formats/image";
import { createConvertedView, decodeText } from "../formats/markdown";
import { FORMATS, registerFormat, unregisterFormat } from "../formats/registry";
import type { FormatPlugin } from "../formats/types";
import { extname } from "../paths";
import { APP_VERSION } from "../releaseNotes";
import type { Config } from "../state";
import { el } from "../ui/overlay";
import { PLUGIN_API, type PluginApi, type PluginIndex, type PluginInstance, type PluginManifest, type PluginModule } from "./api";
import { PluginView } from "./pluginView";

export const RELEASES_URL = "https://github.com/drzdez/markdownz/releases";

/** The plugins of the running version, or the index set in the config for testing. */
export function indexUrl(config: Config): string {
  return config.pluginIndex || `${RELEASES_URL}/download/v${APP_VERSION}/plugins.json`;
}

const installed = new Map<string, PluginManifest>();
const modules = new Map<string, Promise<PluginInstance>>();
let index: { url: string; promise: Promise<PluginIndex> } | null = null;

const API: PluginApi = { api: PLUGIN_API, appVersion: APP_VERSION, readBinary: backend.readBinary, fileUrl: backend.fileSrc, decodeText, createMarkdownView: createConvertedView, createImageView, el };

export function installedPlugins(): PluginManifest[] {
  return [...installed.values()];
}

/** Whether an installed plugin should be replaced by the one in the index. */
export function isOutdated(plugin: PluginManifest, available: PluginManifest | undefined): boolean {
  return plugin.api !== PLUGIN_API || (!!available && available.api === PLUGIN_API && available.version !== plugin.version);
}

/** The plugins available for this version (fetched once per session unless `refresh`). */
export function fetchIndex(config: Config, refresh = false): Promise<PluginIndex> {
  const url = indexUrl(config);
  if (!index || index.url !== url || refresh) {
    const promise = backend.pluginIndex(url).then((text) => {
      const parsed = JSON.parse(text) as PluginIndex;
      if (!Array.isArray(parsed.plugins)) throw new Error("the plugin index is damaged");
      parsed.plugins = parsed.plugins.filter((p) => p.api === PLUGIN_API);
      return parsed;
    });
    // A failed download is tried again next time.
    promise.catch(() => index?.promise === promise && (index = null));
    index = { url, promise };
  }
  return index.promise;
}

/** A plugin of the index, not installed yet, that would show `path`. */
export async function availableFor(path: string, config: Config): Promise<PluginManifest | null> {
  const ext = extname(path);
  if (!ext) return null;
  const { plugins } = await fetchIndex(config);
  return plugins.find((p) => p.extensions.includes(ext) && !installed.has(p.id)) ?? null;
}

function load(plugin: PluginManifest): Promise<PluginInstance> {
  let instance = modules.get(plugin.id);
  if (!instance) {
    // The query keeps an updated plugin from being served from the module cache.
    const url = `${backend.pluginModuleUrl(plugin.id)}?v=${encodeURIComponent(plugin.version)}-${encodeURIComponent(plugin.signature.slice(-12))}`;
    const module = (import(/* @vite-ignore */ url) as Promise<PluginModule>).catch(async (e) => {
      // The import only says it failed; the backend knows why (damaged file, signature).
      const reason = await backend.pluginCheck(plugin.id).then(
        () => (e instanceof Error ? e.message : String(e)),
        (why) => String(why),
      );
      throw new Error(`The ${plugin.name} plugin cannot be loaded: ${reason}. Remove it and install it again in Settings → Plugins.`);
    });
    instance = module.then((m) => {
      if (m.api !== PLUGIN_API) throw new Error(`The ${plugin.name} plugin was made for another version of Markdownz; update it in Settings → Plugins.`);
      return m.default(API);
    });
    instance.catch(() => modules.get(plugin.id) === instance && modules.delete(plugin.id));
    modules.set(plugin.id, instance);
  }
  return instance;
}

function formatOf(plugin: PluginManifest): FormatPlugin {
  return {
    id: plugin.id,
    name: plugin.name,
    description: `${plugin.description} (plugin)`,
    extensions: plugin.extensions,
    defaultEnabled: true,
    createView: (host) => new PluginView(host, () => load(plugin)),
  };
}

function add(plugin: PluginManifest): void {
  // Built-in formats keep their ids.
  if (FORMATS.some((f) => f.id === plugin.id && !installed.has(f.id))) return;
  installed.set(plugin.id, plugin);
  modules.delete(plugin.id);
  registerFormat(formatOf(plugin));
}

/** Registers the installed plugins as formats. */
export async function loadInstalled(): Promise<void> {
  for (const plugin of await backend.pluginList<PluginManifest>()) add(plugin);
}

/** Replaces installed plugins from another version by those of this one; true when any changed. */
export async function updateInstalled(config: Config): Promise<boolean> {
  const old = installedPlugins().filter((p) => p.version !== APP_VERSION || p.api !== PLUGIN_API);
  if (!old.length) return false;
  const { plugins } = await fetchIndex(config);
  let updated = false;
  for (const plugin of old) {
    const available = plugins.find((p) => p.id === plugin.id);
    if (available && isOutdated(plugin, available)) {
      await install(available);
      updated = true;
    }
  }
  return updated;
}

/** Installs the plugins chosen in the installer that are not installed yet; returns their names. */
export async function installChosen(config: Config, ids: string[]): Promise<string[]> {
  const { plugins } = await fetchIndex(config);
  const names: string[] = [];
  for (const plugin of plugins.filter((p) => ids.includes(p.id) && !installed.has(p.id))) {
    await install(plugin);
    names.push(plugin.name);
  }
  return names;
}

export async function install(plugin: PluginManifest): Promise<void> {
  await backend.pluginInstall(plugin);
  add(plugin);
}

export async function remove(id: string): Promise<void> {
  await backend.pluginRemove(id);
  installed.delete(id);
  modules.delete(id);
  unregisterFormat(id);
}

/** "1.2 MB" */
export function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
