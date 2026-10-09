import type { HistoryNode, HistoryTree } from "../history";
import { basename } from "../paths";
import { FORMATS, isFormatEnabled } from "../formats/registry";
import { PLUGINS, isEnabled } from "../render/renderer";
import type { Config, ThemeSetting } from "../state";
import { el, openModal } from "./overlay";

const nodeLabel = (n: HistoryNode) => n.title || basename(n.path);

/** Chooser shown when going forward from a node with several branches. */
export function pickForward(options: HistoryNode[], onPick: (node: HistoryNode) => void): void {
  const list = el("div", { className: "mdz-list" });
  const layer = openModal("Go forward to…", list, {
    onKey(e, close) {
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) {
        close();
        onPick(options[n - 1]);
        return true;
      }
      if (e.key === "ArrowRight" && e.altKey) {
        (document.activeElement as HTMLElement | null)?.click();
        return true;
      }
      return false;
    },
  });
  options.forEach((node, i) => {
    const button = el(
      "button",
      { className: "mdz-list-item", title: node.path },
      el("kbd", { textContent: String(i + 1) }),
      el("span", { textContent: nodeLabel(node) }),
      el("small", { textContent: i === 0 ? `${basename(node.path)} · last visited` : basename(node.path) }),
    );
    button.dataset.nav = "";
    button.addEventListener("click", () => {
      layer.close();
      onPick(node);
    });
    list.append(button);
  });
  list.querySelector<HTMLElement>("[data-nav]")?.focus();
}

/** Whole navigation tree of a tab; click a node to jump there. */
export function showHistoryTree(tree: HistoryTree, onPick: (node: HistoryNode) => void): void {
  const current = tree.current;
  const build = (node: HistoryNode): HTMLLIElement => {
    const button = el("button", { className: "mdz-tree-node", title: node.path, textContent: nodeLabel(node) });
    button.dataset.nav = "";
    if (node.id === current.id) {
      button.classList.add("current");
      button.setAttribute("aria-current", "page");
    }
    button.addEventListener("click", () => {
      layer.close();
      onPick(node);
    });
    const li = el("li", {}, button);
    const children = tree.childrenOf(node);
    if (children.length) li.append(el("ul", {}, ...children.map(build)));
    return li;
  };
  const body = el(
    "div",
    { className: "mdz-tree" },
    el("p", { className: "mdz-hint", textContent: "Every branch you visited is kept. ↑↓ to move, Enter to open." }),
    el("ul", {}, build(tree.root)),
  );
  const layer = openModal("History", body, { className: "wide" });
  body.querySelector<HTMLElement>(".current")?.focus();
}

export function showSettings(config: Config, onChange: (config: Config) => void, checkNow: () => void): void {
  const themes: [ThemeSetting, string][] = [
    ["auto", "Follow system"],
    ["light", "Light"],
    ["dark", "Dark"],
  ];
  const themeGroup = el("fieldset", {}, el("legend", { textContent: "Appearance" }));
  for (const [value, label] of themes) {
    const input = el("input", { type: "radio", name: "theme", value, checked: config.theme === value });
    input.dataset.nav = "";
    input.addEventListener("change", () => {
      config = { ...config, theme: value };
      onChange(config);
    });
    themeGroup.append(el("label", {}, input, ` ${label}`));
  }
  const wide = el("input", { type: "checkbox", checked: config.wideObjects !== false });
  wide.dataset.nav = "";
  wide.addEventListener("change", () => {
    config = { ...config, wideObjects: wide.checked };
    onChange(config);
  });
  const ruler = el("input", { type: "checkbox", checked: config.ruler !== false });
  ruler.dataset.nav = "";
  ruler.addEventListener("change", () => {
    config = { ...config, ruler: ruler.checked };
    onChange(config);
  });
  themeGroup.append(
    el(
      "label",
      { title: "Text stays in a readable column; wider objects get just the room they need so they do not scroll, up to the object width on the ruler" },
      wide,
      " Wide tables, code, diagrams and images may extend beyond the text",
    ),
    el("label", { title: "Drag the stops to set the text width and the widest object; double-click resets" }, ruler, " Width ruler above Markdown documents"),
  );

  const option = (name: string, description: string, checked: boolean, change: (on: boolean) => void) => {
    const input = el("input", { type: "checkbox", checked });
    input.dataset.nav = "";
    input.addEventListener("change", () => change(input.checked));
    return el("label", { className: "mdz-plugin" }, input, el("span", { textContent: name }), el("small", { textContent: description }));
  };

  const formatGroup = el("fieldset", {}, el("legend", { textContent: "Document formats" }));
  for (const format of FORMATS) {
    formatGroup.append(
      option(format.name, format.description, isFormatEnabled(format, config), (on) => {
        config = { ...config, formats: { ...config.formats, [format.id]: on } };
        onChange(config);
      }),
    );
  }

  const pluginGroup = el("fieldset", {}, el("legend", { textContent: "Markdown extensions" }));
  for (const plugin of PLUGINS) {
    pluginGroup.append(
      option(plugin.name, plugin.description, isEnabled(plugin, config.plugins), (on) => {
        config = { ...config, plugins: { ...config.plugins, [plugin.id]: on } };
        onChange(config);
      }),
    );
  }
  const daily = el("input", { type: "checkbox", checked: config.checkUpdates });
  daily.dataset.nav = "";
  daily.addEventListener("change", () => {
    config = { ...config, checkUpdates: daily.checked };
    onChange(config);
  });
  const now = el("button", { className: "mdz-settings-button", textContent: "Check now" });
  const updateGroup = el(
    "fieldset",
    {},
    el("legend", { textContent: "Updates" }),
    el("label", {}, daily, " Check for a new version once a day"),
    now,
  );
  const layer = openModal("Settings", el("div", { className: "mdz-settings" }, themeGroup, formatGroup, pluginGroup, updateGroup));
  now.addEventListener("click", () => {
    layer.close();
    checkNow();
  });
}

const SHORTCUTS: [string, string][] = [
  ["Esc", "Close dialog / find bar, otherwise close the window"],
  ["Ctrl+O", "Open file(s)"],
  ["Ctrl+W · middle click", "Close tab"],
  ["Ctrl+Shift+T", "Reopen closed tab"],
  ["Ctrl+Tab · Ctrl+Shift+Tab", "Next / previous tab"],
  ["Right click on tab", "Close others / to the right / to the left / all"],
  ["Drag a tab", "Reorder tabs"],
  ["Ctrl+1…9", "Go to tab"],
  ["Alt+← · mouse back", "Back"],
  ["Alt+→ · mouse forward", "Forward (asks when there are several branches)"],
  ["Ctrl+H", "History tree of the tab"],
  ["Ctrl+click link", "Open linked document in a new tab"],
  ["Ctrl+F · F3 · Shift+F3", "Find · next · previous"],
  ["Ctrl+B", "Toggle table of contents"],
  ["Ctrl+wheel · Ctrl+ + / − / 0", "Zoom this document in / out / 100 % (also the % button)"],
  ["F5 · Ctrl+R", "Reload document"],
  ["Ctrl+Shift+O", "Open with another application (editor, …)"],
  ["Ctrl+P", "Print: pages per sheet, booklet, two-sided"],
  ["Ctrl+\\ · right click on tab", "Documents side by side (▥ menu: 2, 3, 4)"],
  ["Ctrl+Alt+← / →", "Previous / next document side by side"],
  ["Ctrl+Shift+P", "Pages as printed / continuous (sheets per row in the ▥ menu)"],
  ["Right click on a block or page", "Turn it landscape / portrait, add or copy a marker"],
  ["Ctrl+Z", "Undo the last marker edit (orientation marks)"],
  ["Ctrl+,", "Settings and plugins"],
  ["Click a diagram", "Enlarge; wheel zooms, drag pans"],
  ["F1", "This help"],
];

export function showHelp(): void {
  const mac = navigator.userAgent.includes("Mac");
  const table = el("table", { className: "mdz-shortcuts" });
  for (const [keys, action] of SHORTCUTS) {
    table.append(el("tr", {}, el("td", {}, el("kbd", { textContent: mac ? keys.replace(/Ctrl/g, "⌘").replace(/Alt/g, "⌥") : keys })), el("td", { textContent: action })));
  }
  openModal("Keyboard shortcuts", table, { className: "wide" });
}
