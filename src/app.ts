import * as backend from "./backend";
import { ErrorView } from "./formats/errorView";
import { FORMATS, fileFilters, formatFor } from "./formats/registry";
import type { DocumentView, FormatPlugin, ViewContext } from "./formats/types";
import { HistoryTree, type HistoryState } from "./history";
import { markMissing, relativeTime, touchRecent, type RecentDoc } from "./recent";
import { classifyLink } from "./links";
import { basename, dirname, extname, samePath } from "./paths";
import { DEFAULT_CONFIG, DEFAULT_SESSION, type Config, type Session } from "./state";
import { dropIndex, indicesToClose, moveItem, type CloseScope } from "./tabops";
import { showContextMenu, visibleKeys, type MenuItem } from "./ui/contextMenu";
import { folderIcon } from "./ui/icons";
import { DEFAULT_PRINT_OPTIONS } from "./print/imposition";
import { pickForward, showHelp, showHistoryTree, showSettings } from "./ui/dialogs";
import { openPrintDialog } from "./ui/printDialog";
import { Finder } from "./ui/find";
import { el, topLayer } from "./ui/overlay";
import { effectiveTheme, initTheme, setTheme } from "./ui/theme";
import { Toc } from "./ui/toc";

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 4;
const MAX_CLOSED = 20;

/** How to position the view after rendering. */
type ScrollMode = "restore" | "keep" | "top" | { hash: string };

class Tab {
  /** Holds the tab's document view; each tab keeps its own so switching tabs is instant. */
  readonly frame = el("div", { className: "doc-frame" });
  view: DocumentView | null = null;
  /** Format of `view`, null for error views. */
  format: FormatPlugin | null = null;
  /** History node currently shown, -1 when nothing is rendered yet. */
  renderedNode = -1;
  stale = true;
  /** Increments per render; late results of superseded renders are dropped. */
  token = 0;
  /** Zoom the view was last rendered with. */
  zoom = 0;

  constructor(public history: HistoryTree) {
    this.frame.hidden = true;
  }

  get path(): string {
    return this.history.current.path;
  }

  get title(): string {
    return this.history.current.title || basename(this.path);
  }

  setView(view: DocumentView, format: FormatPlugin | null): void {
    this.view?.dispose();
    this.view = view;
    this.format = format;
    this.frame.replaceChildren(view.element);
  }

  /** Remembers the reading position of the current history node. */
  saveScroll(): void {
    if (this.view && this.renderedNode === this.history.current.id) this.history.current.scroll = this.view.element.scrollTop;
  }
}

export class App {
  private tabs: Tab[] = [];
  private active: Tab | null = null;
  private config: Config = DEFAULT_CONFIG;
  private session: Session = DEFAULT_SESSION;
  private docs = document.getElementById("docs")!;
  private tabbar = document.getElementById("tabbar")!;
  private toc = new Toc();
  private finder = new Finder(
    () => this.active?.view?.find ?? null,
    () => this.active?.view?.element.focus({ preventScroll: true }),
  );
  private welcome: HTMLElement | null = null;
  private saveTimer?: number;
  private watched = "";
  private changeTimers = new Map<string, number>();

  async start(): Promise<void> {
    const saved = await backend.loadState<Partial<Config>>("config");
    this.config = { ...DEFAULT_CONFIG, ...saved };
    this.session = { ...DEFAULT_SESSION, ...(await backend.loadState<Session>("session")) };
    initTheme(this.config.theme, () => this.rerenderAll());
    for (const format of FORMATS) format.configure?.(this.config);
    this.session.zoom = this.clampZoom(this.session.zoom);
    this.toc.visible = this.session.toc;
    this.bindEvents();

    for (const state of this.session.tabs) {
      try {
        this.addTab(HistoryTree.fromJSON(state));
      } catch (e) {
        console.warn("skipping broken tab state", e);
      }
    }
    const restored = this.tabs[Math.min(Math.max(this.session.active, 0), this.tabs.length - 1)];
    const startup = await backend.takeStartupFiles();
    if (startup.length) await this.openFiles(startup);
    else if (restored) await this.activate(restored);
    else this.showWelcome();
    await backend.showWindow();
  }

  private viewContext(): ViewContext {
    return { theme: effectiveTheme(), zoom: this.session.zoom };
  }

  private isViewable = (path: string) => formatFor(path, this.config) !== null;

  // ---------------------------------------------------------------- tabs

  async openFiles(paths: string[]): Promise<void> {
    let last: Tab | null = null;
    for (const path of paths) last = await this.openFile(path);
    if (last) await this.activate(last);
    await backend.showWindow();
  }

  /** Returns the tab showing `path`, creating it when needed (not activated). */
  private async openFile(path: string): Promise<Tab> {
    const canonical = await backend.resolvePath(path).catch(() => path);
    return this.tabs.find((t) => samePath(t.path, canonical)) ?? this.addTab(new HistoryTree(canonical));
  }

  private addTab(history: HistoryTree, index = this.tabs.length): Tab {
    const tab = new Tab(history);
    this.docs.append(tab.frame);
    this.tabs.splice(index, 0, tab);
    this.renderTabbar();
    this.scheduleSave();
    return tab;
  }

  private async activate(tab: Tab): Promise<void> {
    if (this.active && this.active !== tab) this.active.frame.hidden = true;
    this.hideWelcome();
    this.active = tab;
    tab.frame.hidden = false;
    this.renderTabbar();
    if (tab.stale || tab.renderedNode !== tab.history.current.id) await this.renderTab(tab, "restore");
    else {
      if (tab.zoom !== this.session.zoom) this.applyViewZoom(tab);
      this.afterShow(tab);
      // Switching to an already rendered tab also counts as viewing the document.
      if (tab.format) this.session.recent = touchRecent(this.session.recent, tab.path, tab.history.current.title, Date.now());
    }
    tab.view?.element.focus({ preventScroll: true });
    this.scheduleSave();
  }

  private closeTab(tab: Tab | null): void {
    if (tab) this.closeTabs(tab, "this");
  }

  /** Closes tabs relative to `tab`; closed tabs can be reopened with Ctrl+Shift+T. */
  private closeTabs(tab: Tab, scope: CloseScope): void {
    const index = this.tabs.indexOf(tab);
    const closing = indicesToClose(this.tabs.length, index, scope).map((i) => this.tabs[i]);
    if (!closing.length) return;
    for (const t of closing) {
      t.saveScroll();
      t.view?.dispose();
      t.frame.remove();
      this.session.closed.push(t.history.toJSON());
    }
    this.session.closed = this.session.closed.slice(-MAX_CLOSED);
    const activeIndex = this.active ? this.tabs.indexOf(this.active) : -1;
    this.tabs = this.tabs.filter((t) => !closing.includes(t));

    if (this.active && closing.includes(this.active)) {
      this.active = null;
      // Prefer the tab the action was invoked on, then the neighbour of the old active tab.
      const next = this.tabs.includes(tab) ? tab : this.tabs[Math.min(activeIndex, this.tabs.length - 1)];
      if (next) void this.activate(next);
      else this.showWelcome();
    }
    this.renderTabbar();
    this.updateWatch();
    this.scheduleSave();
  }

  private showTabMenu(tab: Tab, x: number, y: number): void {
    const index = this.tabs.indexOf(tab);
    const last = this.tabs.length - 1;
    showContextMenu(x, y, [
      { label: "Close", hint: "Ctrl+W", action: () => this.closeTabs(tab, "this") },
      { label: "Close others", disabled: !last, action: () => this.closeTabs(tab, "others") },
      { label: "Close tabs to the right", disabled: index === last, action: () => this.closeTabs(tab, "right") },
      { label: "Close tabs to the left", disabled: index === 0, action: () => this.closeTabs(tab, "left") },
      { label: "Close all", action: () => this.closeTabs(tab, "all") },
      null,
      { label: "Reopen closed tab", hint: "Ctrl+Shift+T", disabled: !this.session.closed.length, action: () => this.reopenClosed() },
      null,
      { label: "Print…", hint: "Ctrl+P", disabled: tab !== this.active || !tab.view?.printPages, action: () => this.print() },
      ...this.openWithItems(tab.path),
    ]);
  }

  /** "Open with" entries for editors and advanced tools; Markdownz itself stays a viewer. */
  private openWithItems(path: string): MenuItem[] {
    const ext = extname(path);
    const run = (action: () => Promise<void>) => () => void action().catch((e) => toast(`Cannot open: ${e}`));
    const apps = this.config.openWith.filter((a) => !a.extensions?.length || a.extensions.includes(ext));
    return [
      ...apps.map((app) => ({ label: `Open in ${app.name}`, action: run(() => backend.openWith(path, app.program, app.args)) })),
      {
        label: "Open with…",
        hint: "Ctrl+Shift+O",
        action: run(async () => {
          if (!backend.isMac) return backend.openWith(path);
          const app = await backend.pickApplication();
          if (app) await backend.openWith(path, "open", ["-a", app, "{file}"]);
        }),
      },
      { label: "Show in folder", action: run(() => backend.revealFile(path)) },
      { label: "Copy path", action: run(() => navigator.clipboard.writeText(path)) },
    ];
  }

  private showOpenWithMenu(): void {
    const tab = this.active;
    if (!tab) return;
    const anchor = this.tabbar.querySelector<HTMLElement>(".open-with")?.getBoundingClientRect();
    showContextMenu(anchor ? anchor.right - 220 : 40, anchor ? anchor.bottom + 4 : 40, [
      ...this.openWithItems(tab.path),
      null,
      { label: "Print…", hint: "Ctrl+P", disabled: !tab.view?.printPages, action: () => this.print() },
    ]);
  }

  /**
   * Reorders tabs by dragging. Pointer events are used instead of HTML5
   * drag and drop, which the native file-drop handling intercepts.
   */
  private startTabDrag(tab: Tab, item: HTMLElement, down: PointerEvent): void {
    const strip = item.parentElement!;
    const startX = down.clientX;
    let dragging = false;

    const move = (e: PointerEvent) => {
      if (!dragging) {
        if (Math.abs(e.clientX - startX) < 5) return;
        dragging = true;
        item.classList.add("dragging");
      }
      const others = [...strip.children].filter((c) => c !== item) as HTMLElement[];
      const centres = others.map((o) => {
        const r = o.getBoundingClientRect();
        return r.left + r.width / 2;
      });
      const target = others[dropIndex(e.clientX, centres)] ?? null;
      if (item.nextElementSibling !== target) strip.insertBefore(item, target);
      // Scroll the tab strip when dragging near its edges.
      const bounds = strip.getBoundingClientRect();
      if (e.clientX < bounds.left + 20) strip.scrollLeft -= 10;
      else if (e.clientX > bounds.right - 20) strip.scrollLeft += 10;
    };
    // Listen on the window: moving the element in the DOM would drop pointer capture.
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!dragging) return;
      // The click that follows pointerup must not count as a tab click.
      item.addEventListener("click", (e) => e.stopImmediatePropagation(), { capture: true, once: true });
      const to = [...strip.children].indexOf(item);
      this.tabs = moveItem(this.tabs, this.tabs.indexOf(tab), to);
      this.renderTabbar();
      this.scheduleSave();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  private reopenClosed(): void {
    const state = this.session.closed.pop();
    if (!state) return;
    void this.activate(this.addTab(HistoryTree.fromJSON(state)));
  }

  private cycle(dir: number): void {
    if (!this.tabs.length || !this.active) return;
    const i = this.tabs.indexOf(this.active);
    void this.activate(this.tabs[(i + dir + this.tabs.length) % this.tabs.length]);
  }

  /**
   * Checks whether the given recent documents still exist; missing ones are
   * marked, never removed. Called only after a clicked document turned out to be
   * missing, and only for the entries visible at that moment, so long histories
   * never make the lists wait for the file system.
   */
  private async checkRecent(paths: string[]): Promise<void> {
    const results = await Promise.all(paths.map((p) => backend.resolvePath(p).then(() => true, () => false)));
    this.session.recent = markMissing(this.session.recent, new Map(paths.map((p, i) => [p, results[i]])));
    if (this.welcome) this.renderRecentList();
    this.scheduleSave();
  }

  /** `visible`: paths of the entries visible in the list that was clicked. */
  private async openRecent(entry: RecentDoc, visible: string[]): Promise<void> {
    const exists = await backend.resolvePath(entry.path).then(() => true, () => false);
    if (exists) {
      await this.openFiles([entry.path]); // showing it moves it to the top and clears "deleted"
      return;
    }
    toast(`${basename(entry.path)} no longer exists.`, "warning");
    this.session.recent = this.session.recent.map((r) => (samePath(r.path, entry.path) ? { ...r, missing: true } : r));
    if (this.welcome) this.renderRecentList();
    this.scheduleSave();
    void this.checkRecent(visible.filter((p) => !samePath(p, entry.path)));
  }

  /** Shows the document in the file manager (selected), or opens its folder when the file is gone. */
  private async showInFolder(path: string): Promise<void> {
    const exists = await backend.resolvePath(path).then(() => true, () => false);
    try {
      if (exists) await backend.revealFile(path);
      else await backend.openFolder(dirname(path));
    } catch {
      toast(`The folder of ${basename(path)} no longer exists.`, "warning");
    }
  }

  /** The "+" button: recent documents first, then the file dialog. */
  private showOpenMenu(): void {
    const anchor = this.tabbar.querySelector<HTMLElement>(".open-button")?.getBoundingClientRect();
    const recent: MenuItem[] = this.session.recent.map((r) => ({
      label: r.title || basename(r.path),
      detail: r.missing ? `deleted · ${r.path}` : `${relativeTime(r.opened, Date.now())} · ${r.path}`,
      className: r.missing ? "deleted" : "",
      key: r.path,
      action: (visible) => void this.openRecent(r, visible),
      side: { icon: folderIcon(), title: "Show in folder", action: () => void this.showInFolder(r.path) },
    }));
    showContextMenu(anchor ? anchor.left : 40, anchor ? anchor.bottom + 4 : 40, [
      { label: "Open file…", hint: "Ctrl+O", action: () => void this.openDialog() },
      null,
      ...(recent.length ? recent : [{ label: "No recent documents", disabled: true, action: () => {} }]),
    ]);
  }

  private async openDialog(): Promise<void> {
    const paths = await backend.pickFiles(fileFilters(this.config));
    if (paths.length) await this.openFiles(paths);
  }

  // ---------------------------------------------------------- rendering

  private async renderTab(tab: Tab, scroll: ScrollMode): Promise<void> {
    const node = tab.history.current;
    const token = ++tab.token;
    const previousScroll = tab.view?.element.scrollTop ?? 0;
    const format = formatFor(node.path, this.config);
    let title: string | undefined;
    let error: unknown = null;

    if (!format) {
      error = new Error(`No viewer is enabled for .${extname(node.path) || "(no extension)"} files.`);
    } else {
      // Views need to be in the DOM while loading (e.g. PDF layout measures its container).
      if (!tab.view || tab.format !== format) tab.setView(format.createView(this.viewHost(tab)), format);
      try {
        ({ title } = await tab.view!.load(node.path, this.viewContext()));
      } catch (e) {
        error = e;
      }
    }
    if (token !== tab.token) return;
    if (error) {
      tab.setView(new ErrorView(node.path, error, "Use “Open with…” (Ctrl+Shift+O) to open it in another application."), null);
    } else {
      node.title = title;
      this.session.recent = touchRecent(this.session.recent, node.path, title, Date.now());
    }
    tab.renderedNode = node.id;
    tab.stale = false;
    tab.zoom = this.session.zoom;

    const element = tab.view!.element;
    if (scroll === "keep") element.scrollTop = previousScroll;
    else if (scroll === "restore") element.scrollTop = node.scroll;
    else if (scroll === "top") element.scrollTop = 0;
    else if (!tab.view!.scrollToFragment(scroll.hash)) element.scrollTop = 0;

    if (tab === this.active) this.afterShow(tab);
    this.renderTabbar();
    this.updateWatch();
    this.scheduleSave();
  }

  private viewHost(tab: Tab) {
    return {
      followLink: (href: string, newTab: boolean) => {
        if (tab === this.active) void this.followLink(href, newTab);
      },
      onScroll: () => {
        tab.saveScroll();
        if (tab === this.active && tab.view) this.toc.sync(tab.view);
        this.scheduleSave(1000);
      },
    };
  }

  private afterShow(tab: Tab): void {
    if (!tab.view) return;
    this.toc.build(tab.view.outline());
    this.toc.sync(tab.view);
    this.finder.refresh();
    void backend.setWindowTitle(`${tab.title} — Markdownz`);
  }

  /** Theme or settings changed: refresh the active view now, the others when shown. */
  private rerenderAll(): void {
    for (const tab of this.tabs) tab.stale = true;
    const tab = this.active;
    if (!tab?.view || !tab.format) return;
    if (formatFor(tab.path, this.config) !== tab.format) {
      void this.renderTab(tab, "keep");
      return;
    }
    const scroll = tab.view.element.scrollTop;
    void tab.view.refresh(this.viewContext()).then(() => {
      tab.stale = false;
      tab.view!.element.scrollTop = scroll;
      this.afterShow(tab);
    });
  }

  private reload(): void {
    if (this.active) void this.renderTab(this.active, "keep");
  }

  /** Called by the file watcher; debounced because editors often write in several steps. */
  private onDocChanged(path: string): void {
    const key = path.toLowerCase();
    clearTimeout(this.changeTimers.get(key));
    this.changeTimers.set(
      key,
      window.setTimeout(async () => {
        this.changeTimers.delete(key);
        for (const tab of this.tabs.filter((t) => samePath(t.path, path))) {
          // A save may briefly remove the file; give it a moment before reloading.
          await backend.resolvePath(tab.path).catch(() => new Promise((r) => setTimeout(r, 300)));
          if (tab === this.active) await this.renderTab(tab, "keep");
          else tab.stale = true;
        }
      }, 150),
    );
  }

  private updateWatch(): void {
    const paths = [...new Set(this.tabs.map((t) => t.path))];
    const key = paths.join("\n");
    if (key === this.watched) return;
    this.watched = key;
    void backend.watchDocs(paths);
  }

  // --------------------------------------------------------- navigation

  private async followLink(href: string, newTab: boolean): Promise<void> {
    const tab = this.active;
    if (!tab) return;
    const target = classifyLink(href, tab.path, this.isViewable);
    if (!target) return;
    try {
      switch (target.kind) {
        case "anchor":
          tab.view?.scrollToFragment(target.id);
          break;
        case "external":
          await backend.openExternal(target.url);
          break;
        case "file":
          toast(`No viewer for this file type, showing it in the file manager: ${basename(target.path)}`);
          await backend.revealFile(target.path);
          break;
        case "doc":
          if (newTab) await this.openFile(target.path);
          else await this.navigate(tab, target.path, target.hash);
          break;
      }
    } catch (e) {
      toast(`Cannot open ${href}: ${e}`);
    }
  }

  private async navigate(tab: Tab, path: string, hash: string): Promise<void> {
    const canonical = await backend.resolvePath(path);
    if (samePath(canonical, tab.path)) {
      if (hash) tab.view?.scrollToFragment(hash);
      return;
    }
    tab.saveScroll();
    tab.history.navigate(canonical);
    await this.renderTab(tab, hash ? { hash } : "top");
  }

  private async back(): Promise<void> {
    const tab = this.active;
    if (!tab?.history.canBack) return;
    tab.saveScroll();
    tab.history.back();
    await this.renderTab(tab, "restore");
  }

  private async forward(): Promise<void> {
    const tab = this.active;
    if (!tab?.history.canForward) return;
    const go = async (id: number) => {
      tab.saveScroll();
      tab.history.forward(id);
      await this.renderTab(tab, "restore");
    };
    const options = tab.history.forwardOptions();
    if (options.length === 1) await go(options[0].id);
    else pickForward(options, (node) => void go(node.id));
  }

  private showHistory(): void {
    const tab = this.active;
    if (!tab) return;
    showHistoryTree(tab.history, (node) => {
      if (node.id === tab.history.current.id) return;
      tab.saveScroll();
      tab.history.goto(node.id);
      void this.renderTab(tab, "restore");
    });
  }

  // ---------------------------------------------------------------- zoom

  private clampZoom(zoom: number): number {
    return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom || 1)) * 100) / 100;
  }

  private applyZoom(zoom: number, announce = true): void {
    this.session.zoom = this.clampZoom(zoom);
    if (this.active) this.applyViewZoom(this.active);
    if (announce) toast(`${Math.round(this.session.zoom * 100)} %`);
    this.scheduleSave();
  }

  private applyViewZoom(tab: Tab): void {
    tab.view?.setZoom(this.session.zoom);
    tab.zoom = this.session.zoom;
  }

  // ------------------------------------------------------------ session

  private scheduleSave(delay = 300): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.saveSession(), delay);
  }

  private async saveSession(): Promise<void> {
    clearTimeout(this.saveTimer);
    const tabs: HistoryState[] = this.tabs.map((t) => t.history.toJSON());
    this.session.tabs = tabs;
    this.session.active = this.active ? this.tabs.indexOf(this.active) : 0;
    this.session.toc = this.toc.visible;
    await backend.saveState("session", this.session);
  }

  private async quit(): Promise<void> {
    await this.saveSession();
    await backend.closeWindow();
  }

  private print(): void {
    const tab = this.active;
    if (!tab?.view?.printPages) {
      toast("This document cannot be printed.");
      return;
    }
    openPrintDialog(tab.view, tab.title, { ...DEFAULT_PRINT_OPTIONS, ...this.config.print }, (options) => {
      this.config = { ...this.config, print: { ...options } };
      void backend.saveState("config", this.config);
    });
  }

  private async updateConfig(config: Config): Promise<void> {
    const themeChanged = config.theme !== this.config.theme;
    const settingsChanged =
      JSON.stringify([config.plugins, config.formats]) !== JSON.stringify([this.config.plugins, this.config.formats]);
    this.config = config;
    await backend.saveState("config", config);
    if (settingsChanged) for (const format of FORMATS) format.configure?.(config);
    if (themeChanged) setTheme(config.theme); // re-renders via the theme listener when needed
    if (settingsChanged) this.rerenderAll();
  }

  // ------------------------------------------------------------------ UI

  private renderTabbar(): void {
    const tab = this.active;
    const button = (text: string, title: string, onClick: () => void, disabled = false) => {
      const b = el("button", { className: "bar-button", textContent: text, title, disabled });
      b.addEventListener("click", onClick);
      return b;
    };
    const branches = tab?.history.current.children.length ?? 0;
    const forward = button(branches > 1 ? `→${branches}` : "→", branches > 1 ? `Forward (${branches} branches) — Alt+→` : "Forward — Alt+→", () => void this.forward(), !branches);
    const openWith = button("↗", "Open with… — Ctrl+Shift+O", () => this.showOpenWithMenu(), !tab);
    openWith.classList.add("open-with");

    const items = this.tabs.map((t) => {
      const item = el("div", { className: `tab${t === tab ? " active" : ""}`, title: t.path });
      item.setAttribute("role", "tab");
      item.setAttribute("aria-selected", String(t === tab));
      const close = el("button", { className: "tab-close", textContent: "×", title: "Close tab (Ctrl+W)" });
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeTab(t);
      });
      item.append(el("span", { className: "tab-title", textContent: t.title }), close);
      item.addEventListener("click", () => void this.activate(t));
      item.addEventListener("auxclick", (e) => {
        if (e.button === 1) this.closeTab(t);
      });
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showTabMenu(t, e.clientX, e.clientY);
      });
      item.addEventListener("pointerdown", (e) => {
        if (e.button === 0 && !(e.target as Element).closest(".tab-close")) this.startTabDrag(t, item, e);
      });
      return item;
    });

    this.tabbar.replaceChildren(
      button("←", "Back — Alt+←", () => void this.back(), !tab?.history.canBack),
      forward,
      button("⑂", "History tree — Ctrl+H", () => this.showHistory(), !tab),
      el("div", { className: "tabs" }, ...items),
      Object.assign(button("+", "Open — recent documents or a file (Ctrl+O)", () => this.showOpenMenu()), { className: "bar-button open-button" }),
      button("⎙", "Print — Ctrl+P", () => this.print(), !tab?.view?.printPages),
      openWith,
      button("☰", "Table of contents — Ctrl+B", () => this.toggleToc()),
      button("⚙", "Settings — Ctrl+,", () => this.openSettings()),
      button("?", "Keyboard shortcuts — F1", showHelp),
    );
    this.tabbar.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  private toggleToc(): void {
    this.toc.visible = !this.toc.visible;
    if (this.active) this.afterShow(this.active);
    this.scheduleSave();
  }

  private openSettings(): void {
    showSettings(this.config, (config) => void this.updateConfig(config));
  }

  private showWelcome(): void {
    void backend.setWindowTitle("Markdownz");
    this.toc.build([]);
    // On a start without tabs nothing else has drawn the toolbar yet.
    this.renderTabbar();
    if (!this.welcome) {
      const open = el("button", { className: "primary", textContent: "Open document…" });
      open.addEventListener("click", () => void this.openDialog());
      this.welcome = el(
        "section",
        { className: "welcome" },
        el("h1", { textContent: "Markdownz" }),
        el("p", { textContent: "Open a Markdown or PDF document, or drop it here." }),
        open,
        el("div", { className: "welcome-recent" }),
        el("p", { className: "mdz-hint", textContent: "Ctrl+O open · F1 shortcuts · Esc close" }),
      );
      this.docs.append(this.welcome);
    }
    this.renderRecentList();
  }

  /** Recent documents on the landing page; deleted ones stay listed, struck through. */
  private renderRecentList(): void {
    const box = this.welcome?.querySelector(".welcome-recent");
    if (!box) return;
    const now = Date.now();
    const items = this.session.recent.map((r) => {
      const item = el(
        "button",
        { className: `recent-item${r.missing ? " deleted" : ""}`, title: r.missing ? `Deleted: ${r.path}` : r.path },
        el("span", { className: "recent-title", textContent: r.title || basename(r.path) }),
        el("span", { className: "recent-when", textContent: r.missing ? "deleted" : relativeTime(r.opened, now) }),
        el("small", { className: "recent-path", textContent: r.path }),
      );
      item.addEventListener("click", () => void this.openRecent(r, visibleKeys(box as HTMLElement)));
      const folder = el("button", { className: "recent-folder", title: "Show in folder" }, folderIcon());
      folder.setAttribute("aria-label", "Show in folder");
      folder.addEventListener("click", () => void this.showInFolder(r.path));
      const row = el("div", { className: "recent-row" }, item, folder);
      row.dataset.key = r.path;
      return row;
    });
    box.replaceChildren(...(items.length ? [el("h2", { textContent: "Recent" }), ...items] : []));
  }

  private hideWelcome(): void {
    this.welcome?.remove();
    this.welcome = null;
  }

  private bindEvents(): void {
    window.addEventListener("keydown", (e) => this.onKey(e), true);
    // Mouse back/forward buttons.
    window.addEventListener("mouseup", (e) => {
      if (e.button === 3) void this.back();
      if (e.button === 4) void this.forward();
    });
    this.docs.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        this.applyZoom(this.session.zoom * Math.exp(-e.deltaY * 0.002));
      },
      { passive: false },
    );
    if (import.meta.env.PROD) window.addEventListener("contextmenu", (e) => e.preventDefault());

    backend.onOpenFiles((paths) => void this.openFiles(paths));
    backend.onDropFiles((paths) => void this.openFiles(paths));
    backend.onDocChanged((path) => this.onDocChanged(path));
    backend.onCloseRequested(() => this.saveSession());
  }

  private onKey(e: KeyboardEvent): void {
    const layer = topLayer();
    if (e.key === "Escape") {
      e.preventDefault();
      if (layer) layer.close();
      else void this.quit();
      return;
    }
    if (layer?.onKey?.(e)) {
      e.preventDefault();
      return;
    }

    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    let handled = true;
    if (mod && !e.altKey) {
      if (key === "+" || key === "=" || e.code === "NumpadAdd") this.applyZoom(this.session.zoom * 1.1);
      else if (key === "-" || e.code === "NumpadSubtract") this.applyZoom(this.session.zoom / 1.1);
      else if (key === "0" || e.code === "Numpad0") this.applyZoom(1);
      else if (key === "t" && e.shiftKey) this.reopenClosed();
      else if (key === "o" && e.shiftKey) this.showOpenWithMenu();
      else if (key === "o" || key === "t") void this.openDialog();
      else if (key === "w") this.closeTab(this.active);
      else if (key === "tab") this.cycle(e.shiftKey ? -1 : 1);
      else if (key === "pagedown") this.cycle(1);
      else if (key === "pageup") this.cycle(-1);
      else if (/^Digit[1-9]$/.test(e.code)) {
        const n = Number(e.code.slice(5));
        const tab = n === 9 ? this.tabs[this.tabs.length - 1] : this.tabs[n - 1];
        if (tab) void this.activate(tab);
      } else if (key === "f") this.finder.open();
      else if (key === "g") this.finder.step(e.shiftKey ? -1 : 1);
      else if (key === "b") this.toggleToc();
      else if (key === "h") this.showHistory();
      else if (key === ",") this.openSettings();
      else if (key === "p") this.print();
      else if (key === "r") this.reload();
      else if (key === "[") void this.back();
      else if (key === "]") void this.forward();
      else handled = false;
    } else if (e.altKey && !mod) {
      if (e.key === "ArrowLeft") void this.back();
      else if (e.key === "ArrowRight") void this.forward();
      else handled = false;
    } else if (e.key === "F1") showHelp();
    else if (e.key === "F3") this.finder.step(e.shiftKey ? -1 : 1);
    else if (e.key === "F5") this.reload();
    else handled = false;

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
}

let toastTimer: number | undefined;

/** Short message; "warning" shows it in the middle of the window in a colour that cannot be missed. */
export function toast(message: string, kind: "info" | "warning" = "info"): void {
  const box = document.getElementById("toast")!;
  box.textContent = message;
  box.classList.toggle("warning", kind === "warning");
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (box.hidden = true), 2500);
}
