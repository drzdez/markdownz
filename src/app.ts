import * as backend from "./backend";
import { HistoryTree, type HistoryState } from "./history";
import { classifyLink } from "./links";
import { basename, samePath } from "./paths";
import { Renderer, slugify } from "./render/renderer";
import { DEFAULT_CONFIG, DEFAULT_SESSION, type Config, type Session } from "./state";
import { dropIndex, indicesToClose, moveItem, type CloseScope } from "./tabops";
import { showContextMenu } from "./ui/contextMenu";
import { openDiagram } from "./ui/diagramViewer";
import { pickForward, showHelp, showHistoryTree, showSettings } from "./ui/dialogs";
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
  /** Scroll container; each tab keeps its own so switching tabs is instant. */
  readonly view = el("section", { className: "doc-view", tabIndex: -1 });
  article: HTMLElement | null = null;
  /** History node currently shown, -1 when nothing is rendered yet. */
  renderedNode = -1;
  stale = true;
  /** Increments per render; late results of superseded renders are dropped. */
  token = 0;

  constructor(public history: HistoryTree) {
    this.view.hidden = true;
  }

  get path(): string {
    return this.history.current.path;
  }

  get title(): string {
    return this.history.current.title || basename(this.path);
  }
}

export class App {
  private tabs: Tab[] = [];
  private active: Tab | null = null;
  private config: Config = DEFAULT_CONFIG;
  private session: Session = DEFAULT_SESSION;
  private renderer!: Renderer;
  private docs = document.getElementById("docs")!;
  private tabbar = document.getElementById("tabbar")!;
  private toc = new Toc();
  private finder = new Finder(() => this.active?.article ?? null);
  /** Canonical path -> file content; dropped when the file changes on disk. */
  private sources = new Map<string, string>();
  private welcome: HTMLElement | null = null;
  private saveTimer?: number;
  private watched = "";
  private changeTimers = new Map<string, number>();

  async start(): Promise<void> {
    this.config = { ...DEFAULT_CONFIG, ...(await backend.loadState<Config>("config")) };
    this.session = { ...DEFAULT_SESSION, ...(await backend.loadState<Session>("session")) };
    initTheme(this.config.theme, () => this.rerenderAll());
    this.renderer = new Renderer(this.config.plugins);
    this.applyZoom(this.session.zoom, false);
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

  // ---------------------------------------------------------------- tabs

  async openFiles(paths: string[]): Promise<void> {
    let last: Tab | null = null;
    for (const path of paths) last = await this.openFile(path);
    if (last) await this.activate(last);
    await backend.showWindow();
  }

  /** Returns the tab showing `path`, creating it when needed (not activated). */
  private async openFile(path: string): Promise<Tab> {
    const canonical = (await this.load(path).catch(() => null))?.path ?? path;
    return this.tabs.find((t) => samePath(t.path, canonical)) ?? this.addTab(new HistoryTree(canonical));
  }

  private addTab(history: HistoryTree, index = this.tabs.length): Tab {
    const tab = new Tab(history);
    tab.view.addEventListener("scroll", () => {
      if (tab.renderedNode === tab.history.current.id) tab.history.current.scroll = tab.view.scrollTop;
      if (tab === this.active) this.toc.sync(tab.view);
      this.scheduleSave(1000);
    });
    this.docs.append(tab.view);
    this.tabs.splice(index, 0, tab);
    this.renderTabbar();
    this.scheduleSave();
    return tab;
  }

  private async activate(tab: Tab): Promise<void> {
    if (this.active && this.active !== tab) this.active.view.hidden = true;
    this.hideWelcome();
    this.active = tab;
    tab.view.hidden = false;
    this.renderTabbar();
    if (tab.stale || tab.renderedNode !== tab.history.current.id) await this.renderTab(tab, "restore");
    else this.afterShow(tab);
    tab.view.focus({ preventScroll: true });
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
      t.view.remove();
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

  private async openDialog(): Promise<void> {
    const paths = await backend.pickFiles();
    if (paths.length) await this.openFiles(paths);
  }

  // ---------------------------------------------------------- rendering

  private async load(path: string): Promise<backend.Doc> {
    const doc = await backend.readDoc(path);
    this.sources.set(doc.path, doc.content);
    return doc;
  }

  private async renderTab(tab: Tab, scroll: ScrollMode): Promise<void> {
    const node = tab.history.current;
    const token = ++tab.token;
    let article: HTMLElement;
    let ok = true;
    try {
      const content = this.sources.get(node.path) ?? (await this.load(node.path)).content;
      article = await this.renderer.render(content, { docPath: node.path, theme: effectiveTheme() });
    } catch (e) {
      article = this.errorView(node.path, e);
      ok = false;
    }
    if (token !== tab.token) return;

    const previousScroll = tab.view.scrollTop;
    if (tab.article) tab.article.replaceWith(article);
    else tab.view.append(article);
    tab.article = article;
    tab.renderedNode = node.id;
    tab.stale = false;
    if (ok) node.title = article.querySelector("h1")?.textContent?.trim() || undefined;

    if (scroll === "keep") tab.view.scrollTop = previousScroll;
    else if (scroll === "restore") tab.view.scrollTop = node.scroll;
    else if (scroll === "top") tab.view.scrollTop = 0;
    else if (!this.scrollToId(tab, scroll.hash)) tab.view.scrollTop = 0;

    if (tab === this.active) this.afterShow(tab);
    this.renderTabbar();
    this.updateWatch();
    this.scheduleSave();
  }

  private errorView(path: string, error: unknown): HTMLElement {
    return el(
      "article",
      { className: "markdown-body mdz-error" },
      el("h1", { textContent: "Cannot open document" }),
      el("p", {}, el("code", { textContent: path })),
      el("pre", { textContent: String(error) }),
    );
  }

  private afterShow(tab: Tab): void {
    this.toc.build(tab.article, (heading) => heading.scrollIntoView({ block: "start" }));
    this.toc.sync(tab.view);
    this.finder.refresh();
    void backend.setWindowTitle(`${tab.title} — Markdownz`);
  }

  private rerenderAll(): void {
    for (const tab of this.tabs) tab.stale = true;
    if (this.active) void this.renderTab(this.active, "keep");
  }

  private reload(): void {
    const tab = this.active;
    if (!tab) return;
    this.sources.delete(tab.path);
    void this.renderTab(tab, "keep");
  }

  /** Called by the file watcher; debounced because editors often write in several steps. */
  private onDocChanged(path: string): void {
    const key = path.toLowerCase();
    clearTimeout(this.changeTimers.get(key));
    this.changeTimers.set(
      key,
      window.setTimeout(async () => {
        this.changeTimers.delete(key);
        for (const cached of [...this.sources.keys()]) if (samePath(cached, path)) this.sources.delete(cached);
        for (const tab of this.tabs.filter((t) => samePath(t.path, path))) {
          // A save may briefly remove the file; give it one more chance before showing an error.
          await this.load(tab.path).catch(() => new Promise((r) => setTimeout(r, 300)));
          if (tab === this.active) await this.renderTab(tab, "keep");
          else tab.stale = true;
        }
      }, 120),
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
    const target = classifyLink(href, tab.path);
    if (!target) return;
    try {
      switch (target.kind) {
        case "anchor":
          this.scrollToId(tab, target.id);
          break;
        case "external":
          await backend.openExternal(target.url);
          break;
        case "file":
          toast(`Not a Markdown file, showing it in the file manager: ${basename(target.path)}`);
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
    const doc = await this.load(path);
    if (samePath(doc.path, tab.path)) {
      if (hash) this.scrollToId(tab, hash);
      return;
    }
    tab.history.current.scroll = tab.view.scrollTop;
    tab.history.navigate(doc.path);
    await this.renderTab(tab, hash ? { hash } : "top");
  }

  private async back(): Promise<void> {
    const tab = this.active;
    if (!tab?.history.canBack) return;
    tab.history.current.scroll = tab.view.scrollTop;
    tab.history.back();
    await this.renderTab(tab, "restore");
  }

  private async forward(): Promise<void> {
    const tab = this.active;
    if (!tab?.history.canForward) return;
    const go = async (id: number) => {
      tab.history.current.scroll = tab.view.scrollTop;
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
      tab.history.current.scroll = tab.view.scrollTop;
      tab.history.goto(node.id);
      void this.renderTab(tab, "restore");
    });
  }

  private scrollToId(tab: Tab, id: string): boolean {
    const article = tab.article;
    if (!article || !id) return false;
    const target =
      article.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"], [name="${CSS.escape(id)}"]`) ??
      article.querySelector<HTMLElement>(`[id="${CSS.escape(slugify(id))}"]`);
    target?.scrollIntoView({ block: "start" });
    return !!target;
  }

  // ---------------------------------------------------------------- zoom

  private applyZoom(zoom: number, announce = true): void {
    zoom = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) * 100) / 100;
    const view = this.active?.view;
    const ratio = view && view.scrollHeight > 0 ? view.scrollTop / view.scrollHeight : 0;
    this.session.zoom = zoom;
    this.docs.style.setProperty("--zoom", String(zoom));
    if (view) view.scrollTop = ratio * view.scrollHeight;
    if (announce) toast(`${Math.round(zoom * 100)} %`);
    this.scheduleSave();
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

  private async updateConfig(config: Config): Promise<void> {
    const themeChanged = config.theme !== this.config.theme;
    const pluginsChanged = JSON.stringify(config.plugins) !== JSON.stringify(this.config.plugins);
    this.config = config;
    await backend.saveState("config", config);
    if (pluginsChanged) this.renderer.configure(config.plugins);
    if (themeChanged) setTheme(config.theme); // re-renders via the theme listener when needed
    if (pluginsChanged) this.rerenderAll();
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
      button("+", "Open file — Ctrl+O", () => void this.openDialog()),
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
    this.toc.build(null, () => {});
    if (this.welcome) return;
    const open = el("button", { className: "primary", textContent: "Open Markdown file…" });
    open.addEventListener("click", () => void this.openDialog());
    this.welcome = el(
      "section",
      { className: "welcome" },
      el("h1", { textContent: "Markdownz" }),
      el("p", { textContent: "Open a Markdown file or drop it here." }),
      open,
      el("p", { className: "mdz-hint", textContent: "Ctrl+O open · F1 shortcuts · Esc close" }),
    );
    this.docs.append(this.welcome);
  }

  private hideWelcome(): void {
    this.welcome?.remove();
    this.welcome = null;
  }

  private bindEvents(): void {
    window.addEventListener("keydown", (e) => this.onKey(e), true);

    this.docs.addEventListener("click", (e) => {
      const target = e.target as Element;
      const link = target.closest("a");
      if (link) {
        const href = link.getAttribute("href") ?? link.getAttribute("xlink:href");
        e.preventDefault();
        if (href) void this.followLink(href, e.ctrlKey || e.metaKey);
        return;
      }
      const figure = target.closest<HTMLElement>("figure.mdz-diagram");
      if (figure && !window.getSelection()?.toString()) openDiagram(figure);
    });
    this.docs.addEventListener("auxclick", (e) => {
      const href = (e.target as Element).closest("a")?.getAttribute("href");
      if (e.button === 1 && href) {
        e.preventDefault();
        void this.followLink(href, true);
      }
    });
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
      else if (key === "p") void backend.printPage();
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

export function toast(message: string): void {
  const box = document.getElementById("toast")!;
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (box.hidden = true), 2500);
}
