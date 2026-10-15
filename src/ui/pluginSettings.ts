import { isFormatEnabled, FORMATS } from "../formats/registry";
import type { PluginManifest } from "../plugins/api";
import * as plugins from "../plugins/manager";
import type { Config } from "../state";
import { el } from "./overlay";

export interface PluginSettingsHost {
  config(): Config;
  /** Turns an installed plugin's format on or off (like the built-in formats). */
  enable(id: string, on: boolean): void;
  /** A plugin was installed, updated or removed. */
  changed(): void;
}

/** Settings → Plugins: the installed plugins and those available for this version, with Install / Update / Remove. */
export function pluginSettings(host: PluginSettingsHost): HTMLElement {
  const list = el("div", { className: "mdz-plugin-list" });
  const status = el("p", { className: "mdz-hint" });
  const group = el(
    "fieldset",
    {},
    el("legend", { textContent: "Plugins" }),
    el("p", { className: "mdz-hint", textContent: "More formats, downloaded only when you install them. Plugins come with each Markdownz release and are signed by it." }),
    list,
    status,
  );
  let available: PluginManifest[] = [];

  const render = () => {
    const installed = new Map(plugins.installedPlugins().map((p) => [p.id, p]));
    const all = [...available.filter((p) => !installed.has(p.id)), ...installed.values()].sort((a, b) => a.name.localeCompare(b.name));
    list.replaceChildren(
      ...all.map((plugin) => {
        const mine = installed.get(plugin.id);
        const offered = available.find((p) => p.id === plugin.id);
        const row = el("div", { className: "mdz-plugin" });
        const toggle = el("input", { type: "checkbox", disabled: !mine });
        const format = FORMATS.find((f) => f.id === plugin.id);
        toggle.checked = !!mine && !!format && isFormatEnabled(format, host.config());
        toggle.dataset.nav = "";
        toggle.addEventListener("change", () => host.enable(plugin.id, toggle.checked));
        const action = (label: string, run: () => Promise<void>) => {
          const b = el("button", { className: "mdz-settings-button", textContent: label });
          b.addEventListener("click", async () => {
            for (const button of list.querySelectorAll("button")) button.disabled = true;
            status.textContent = `${label}: ${plugin.name}…`;
            try {
              await run();
              status.textContent = "";
              host.changed();
            } catch (e) {
              status.textContent = `${label} failed: ${e instanceof Error ? e.message : e}`;
            }
            render();
          });
          return b;
        };
        const buttons = el("span", { className: "mdz-plugin-actions" });
        if (!mine) buttons.append(action(`Install (${plugins.formatSize(plugin.size)})`, () => plugins.install(plugin)));
        else {
          if (offered && plugins.isOutdated(mine, offered)) buttons.append(action("Update", () => plugins.install(offered)));
          buttons.append(action("Remove", () => plugins.remove(plugin.id)));
        }
        const extensions = plugin.extensions.map((e) => `.${e}`).join(" ");
        row.append(
          toggle,
          el("span", { textContent: plugin.name }, buttons),
          el("small", { textContent: `${plugin.description} · ${extensions}${mine ? ` · installed ${mine.version}` : ""}` }),
        );
        return row;
      }),
    );
    if (!all.length && !status.textContent) status.textContent = "No plugins.";
  };

  const fetch = () => {
    status.textContent = "Loading the plugins of this version…";
    plugins
      .fetchIndex(host.config())
      .then((index) => {
        available = index.plugins;
        status.textContent = "";
      })
      .catch((e) => {
        const retry = el("button", { className: "mdz-settings-button", textContent: "Try again" });
        retry.addEventListener("click", fetch);
        status.replaceChildren(`Cannot load the list of plugins (${e instanceof Error ? e.message : e}). `, retry);
      })
      .finally(render);
  };
  render();
  fetch();
  return group;
}
