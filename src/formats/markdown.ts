import * as backend from "../backend";
import { Renderer, slugify } from "../render/renderer";
import { openDiagram } from "../ui/diagramViewer";
import { DomFindProvider } from "../ui/domFind";
import { el } from "../ui/overlay";
import type { DocumentView, FormatPlugin, OutlineItem, ViewContext, ViewHost } from "./types";

let renderer: Renderer | null = null;
let pluginSettings: Record<string, boolean> = {};

function getRenderer(): Renderer {
  return (renderer ??= new Renderer(pluginSettings));
}

class MarkdownView implements DocumentView {
  readonly element = el("section", { className: "doc-view", tabIndex: -1 });
  readonly find = new DomFindProvider(() => this.article);
  private article: HTMLElement | null = null;
  private path = "";
  private source = "";

  constructor(host: ViewHost) {
    this.element.addEventListener("scroll", () => host.onScroll());
    this.element.addEventListener("click", (e) => {
      const target = e.target as Element;
      const link = target.closest("a");
      if (link) {
        e.preventDefault();
        const href = link.getAttribute("href") ?? link.getAttribute("xlink:href");
        if (href) host.followLink(href, e.ctrlKey || e.metaKey);
        return;
      }
      const figure = target.closest<HTMLElement>("figure.mdz-diagram");
      if (figure && !window.getSelection()?.toString()) openDiagram(figure);
    });
    this.element.addEventListener("auxclick", (e) => {
      const href = (e.target as Element).closest("a")?.getAttribute("href");
      if (e.button === 1 && href) {
        e.preventDefault();
        host.followLink(href, true);
      }
    });
  }

  async load(path: string, ctx: ViewContext): Promise<{ title?: string }> {
    const doc = await backend.readDoc(path);
    this.path = doc.path;
    this.source = doc.content;
    await this.refresh(ctx);
    return { title: this.article?.querySelector("h1")?.textContent?.trim() || undefined };
  }

  async refresh(ctx: ViewContext): Promise<void> {
    const article = await getRenderer().render(this.source, { docPath: this.path, theme: ctx.theme });
    if (this.article) this.article.replaceWith(article);
    else this.element.append(article);
    this.article = article;
    this.setZoom(ctx.zoom);
  }

  setZoom(zoom: number): void {
    const ratio = this.element.scrollHeight > 0 ? this.element.scrollTop / this.element.scrollHeight : 0;
    this.element.style.setProperty("--zoom", String(zoom));
    this.element.scrollTop = ratio * this.element.scrollHeight;
  }

  scrollToFragment(fragment: string): boolean {
    if (!this.article || !fragment) return false;
    const target =
      this.article.querySelector<HTMLElement>(`[id="${CSS.escape(fragment)}"], [name="${CSS.escape(fragment)}"]`) ??
      this.article.querySelector<HTMLElement>(`[id="${CSS.escape(slugify(fragment))}"]`);
    target?.scrollIntoView({ block: "start" });
    return !!target;
  }

  outline(): OutlineItem[] {
    const headings = this.article ? [...this.article.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")] : [];
    return headings.map((heading) => ({
      title: heading.textContent ?? "",
      level: Number(heading.tagName[1]),
      position: () => heading.getBoundingClientRect().top - this.element.getBoundingClientRect().top + this.element.scrollTop,
      activate: () => heading.scrollIntoView({ block: "start" }),
    }));
  }

  position(): number {
    return this.element.scrollTop + 16;
  }

  dispose(): void {
    this.find.clear();
    this.element.remove();
  }
}

export const markdownFormat: FormatPlugin = {
  id: "markdown",
  name: "Markdown",
  description: ".md, .markdown and similar, with the extensions below",
  extensions: ["md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "mdtxt", "mdtext"],
  defaultEnabled: true,
  configure(config) {
    pluginSettings = config.plugins;
    renderer?.configure(config.plugins);
  },
  createView: (host) => new MarkdownView(host),
};
