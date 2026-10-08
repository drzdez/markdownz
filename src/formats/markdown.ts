import * as backend from "../backend";
import type { PageLayoutOptions } from "../print/imposition";
import { measureBreaks, paginateMixed, type TableHeader } from "../print/paginate";
import { ensurePaperStyle, waitForImages } from "../print/printJob";
import { Renderer, slugify } from "../render/renderer";
import { openDiagram } from "../ui/diagramViewer";
import { DomFindProvider } from "../ui/domFind";
import { el } from "../ui/overlay";
import { Ruler } from "../ui/ruler";
import type { DocExceptions } from "../print/orientation";
import { planOrientation } from "./pageOrientation";
import { DEFAULT_TEXT_WIDTH, fitObjectsForPaper, fitWideObjects, type Widths } from "./wideObjects";
import type { DocumentView, FormatPlugin, OutlineItem, PrintPages, ViewContext, ViewHost } from "./types";

/** Printed page margin in mm. */
const PAGE_MARGIN = 15;
const PX_PER_MM = 96 / 25.4;

let renderer: Renderer | null = null;
let pluginSettings: Record<string, boolean> = {};

/** Layout settings shared by all Markdown views (from the config, changed live by the ruler). */
const layout = { wideObjects: true, ruler: true, widths: { text: DEFAULT_TEXT_WIDTH, objects: DEFAULT_TEXT_WIDTH } as Widths };
const views = new Set<MarkdownView>();
/** Your page orientation exceptions per document path (from the config). */
let exceptions: Record<string, DocExceptions> = {};

/** Header rows of the tables in a laid-out article, for repeating them on following pages. */
function tableHeaders(article: HTMLElement): TableHeader[] {
  const top = article.getBoundingClientRect().top;
  return [...article.querySelectorAll("table")].flatMap((table) => {
    const first = table.rows[0];
    const head = table.tHead ?? (first && [...first.cells].every((c) => c.tagName === "TH") ? first : null);
    if (!head) return [];
    const h = head.getBoundingClientRect();
    const t = table.getBoundingClientRect();
    if (h.height <= 0 || t.bottom - h.bottom < 1) return [];
    return [{ top: Math.floor(h.top - top), bottom: Math.ceil(h.bottom - top), end: Math.ceil(t.bottom - top) }];
  });
}

/** The ruler changed the widths: apply them to every view; tell the app (which saves them) on release. */
function changeWidths(widths: Widths, done: boolean): void {
  layout.widths = widths;
  for (const view of views) view.layout();
  if (done) window.dispatchEvent(new CustomEvent<Widths>("mdz-widths", { detail: widths }));
}

function getRenderer(): Renderer {
  return (renderer ??= new Renderer(pluginSettings));
}

class MarkdownView implements DocumentView {
  readonly reflows = true;
  readonly element = el("section", { className: "doc-view", tabIndex: -1 });
  readonly find = new DomFindProvider(() => this.article);
  private article: HTMLElement | null = null;
  private path = "";
  private source = "";
  private zoom = 1;
  private fitFrame = 0;
  private resizeObserver: ResizeObserver;
  private ruler = new Ruler(this.element, {
    widths: () => layout.widths,
    zoom: () => this.zoom,
    textBox: () => {
      if (!this.article) return null;
      const box = this.article.getBoundingClientRect();
      const padding = parseFloat(getComputedStyle(this.article).paddingLeft) * this.zoom;
      return { left: box.left + padding, width: box.width - 2 * padding };
    },
    change: changeWidths,
  });

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
    this.element.append(this.ruler.element);
    // The view (window, panes, table of contents) or the article (images loading) changed size.
    this.resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(this.fitFrame);
      this.fitFrame = requestAnimationFrame(() => this.layout());
    });
    this.resizeObserver.observe(this.element);
    views.add(this);
  }

  /** Applies the text width, lays out wide objects and moves the ruler stops. */
  layout(): void {
    this.element.style.setProperty("--text-width", `${layout.widths.text}px`);
    this.ruler.element.hidden = !layout.ruler;
    if (!this.article) return;
    fitWideObjects(this.article, this.element, this.zoom, layout.wideObjects ? layout.widths : null);
    if (layout.ruler) this.ruler.update();
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
    if (this.article) {
      this.resizeObserver.unobserve(this.article);
      this.article.replaceWith(article);
    } else this.element.append(article);
    this.article = article;
    this.resizeObserver.observe(article);
    this.setZoom(ctx.zoom);
  }

  setZoom(zoom: number): void {
    const ratio = this.element.scrollHeight > 0 ? this.element.scrollTop / this.element.scrollHeight : 0;
    this.zoom = zoom;
    this.element.style.setProperty("--zoom", String(zoom));
    this.layout();
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

  /**
   * Re-renders in the light theme at the paper's text width and splits it into
   * pages. With landscape pages for wide tables, a page showing one is turned:
   * the text keeps its width and position on the left, the table extends to
   * the right, and the pages go on where the previous one ended.
   */
  async printPages(
    paper: { width: number; height: number },
    _onProgress?: unknown,
    layout: PageLayoutOptions = { wideTables: "shrink", fontPt: 10.5, minFontPt: 7, overflow: "split", repeatHeaders: true },
  ): Promise<PrintPages> {
    const contentWidth = paper.width - 2 * PAGE_MARGIN;
    const contentHeight = paper.height - 2 * PAGE_MARGIN;
    // Portrait pages can be turned for wide content; when every page is landscape already, they cannot.
    const portrait = paper.height > paper.width;
    const turned = { width: paper.height, height: paper.width };
    const wideWidth = portrait ? turned.width - 2 * PAGE_MARGIN : contentWidth;
    const settings = layout.wideTables === "landscape" && !portrait ? "shrink" : layout.wideTables;
    ensurePaperStyle();
    const article = await getRenderer().render(this.source, { docPath: this.path, theme: "light" });
    article.style.fontSize = `${layout.fontPt}pt`;
    const measure = el("div", { className: "mdz-paper mdz-measure" }, article);
    measure.style.width = `${contentWidth}mm`;
    document.body.append(measure);
    await waitForImages(measure);
    await document.fonts.ready;
    const plan = planOrientation(article, exceptions[this.path]?.items ?? [], settings, portrait);
    const fitted = fitObjectsForPaper(article, {
      modeFor: plan.modeFor,
      landscapeRoom: wideWidth * PX_PER_MM,
      minFontPx: (layout.minFontPt * 96) / 72,
      split: layout.overflow === "split",
    });
    const { wide, breaks, portraitBlocks, notes } = plan.finish(fitted);
    const { candidates, avoid, total } = measureBreaks(article);
    const headers = layout.repeatHeaders ? tableHeaders(article) : [];
    // A page never ends right after the header rows.
    for (const h of headers) avoid.add(h.bottom);
    const ranges = paginateMixed(candidates, total, contentHeight * PX_PER_MM, (turned.height - 2 * PAGE_MARGIN) * PX_PER_MM, wide, avoid, headers, breaks, portraitBlocks);
    measure.remove();

    return {
      notes: notes(ranges),
      count: ranges.length,
      size: (index) => (ranges[index].landscape ? turned : paper),
      render: (index) => {
        const { start, end, landscape, header } = ranges[index];
        const width = `${landscape ? wideWidth : contentWidth}mm`;
        // A window onto the laid-out article; the article keeps the portrait text width,
        // a landscape page shows more to its right.
        const view = (from: number, to: number) => {
          const clone = article.cloneNode(true) as HTMLElement;
          clone.style.marginTop = `${-from}px`;
          clone.style.width = `${contentWidth}mm`;
          const clip = el("div", { className: "mdz-md-clip" }, clone);
          Object.assign(clip.style, { width, height: `${to - from}px` });
          return clip;
        };
        const page = el("div", { className: "mdz-md-page" }, ...(header ? [view(header.top, header.bottom)] : []), view(start, end));
        page.style.padding = `${PAGE_MARGIN}mm`;
        return page;
      },
      dispose: () => {},
    };
  }

  dispose(): void {
    this.find.clear();
    this.resizeObserver.disconnect();
    views.delete(this);
    cancelAnimationFrame(this.fitFrame);
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
    exceptions = config.pageExceptions ?? {};
    layout.wideObjects = config.wideObjects !== false;
    layout.ruler = config.ruler !== false;
    layout.widths = { text: config.widths?.text ?? DEFAULT_TEXT_WIDTH, objects: config.widths?.objects ?? config.widths?.text ?? DEFAULT_TEXT_WIDTH };
    for (const view of views) view.layout();
    renderer?.configure(config.plugins);
  },
  createView: (host) => new MarkdownView(host),
};
