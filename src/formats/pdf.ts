import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import type { EventBus, PDFFindController, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import * as backend from "../backend";
import { toFileUrl } from "../paths";
import { el } from "../ui/overlay";
import type { DocumentView, FindProvider, FormatPlugin, OutlineItem, ViewContext, ViewHost } from "./types";

type Engine = typeof import("./pdfEngine");
let engine: Promise<Engine> | undefined;
const loadEngine = () => (engine ??= import("./pdfEngine"));

type OutlineNode = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>[number];

class PdfView implements DocumentView {
  // pdf.js requires DIV elements for both the scroll container and the pages.
  readonly element = el("div", { className: "doc-view pdf-view", tabIndex: -1 });
  private pages = el("div", { className: "pdfViewer" });
  private viewer?: PDFViewer;
  private eventBus?: EventBus;
  private links?: PDFLinkService;
  private task?: PDFDocumentLoadingTask;
  private doc?: PDFDocumentProxy;
  private items: OutlineItem[] = [];
  /** Scale of pdf.js "auto" fit for the current container width; zoom multiplies it. */
  private baseScale = 1;
  private zoom = 1;
  private resizeFrame = 0;

  readonly find: FindProvider = {
    find: (query, direction, again) =>
      this.eventBus?.dispatch("find", {
        source: this,
        type: again ? "again" : "",
        query,
        caseSensitive: false,
        entireWord: false,
        highlightAll: true,
        findPrevious: direction < 0,
        matchDiacritics: false,
      }),
    clear: () => this.eventBus?.dispatch("findbarclose", { source: this }),
  };

  constructor(private host: ViewHost) {
    this.element.append(this.pages);
    this.element.addEventListener("scroll", () => host.onScroll());
    // Internal links ("#...") are handled by pdf.js; everything else goes through the app.
    this.element.addEventListener("click", (e) => {
      const href = (e.target as Element).closest("a")?.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      e.preventDefault();
      host.followLink(href, e.ctrlKey || e.metaKey);
    });
    // Keep the fit when the window or the table of contents changes the available width.
    new ResizeObserver(() => {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => this.fit());
    }).observe(this.element);
  }

  private fit(): void {
    if (!this.viewer || !this.doc || !this.element.clientWidth) return;
    this.viewer.currentScaleValue = "auto";
    this.baseScale = this.viewer.currentScale;
    this.viewer.currentScale = this.baseScale * this.zoom;
  }

  private async setup(): Promise<void> {
    if (this.viewer) return;
    const { viewer: lib } = await loadEngine();
    const eventBus = new lib.EventBus();
    const links = new lib.PDFLinkService({ eventBus });
    const findController: PDFFindController = new lib.PDFFindController({ eventBus, linkService: links });
    const viewer = new lib.PDFViewer({
      container: this.element,
      viewer: this.pages,
      eventBus,
      linkService: links,
      findController,
      removePageBorders: false,
    });
    links.setViewer(viewer);
    const report = ({ matchesCount, state }: { matchesCount?: { current: number; total: number }; state?: number }) => {
      const count = state === 1 /* NOT_FOUND */ ? 0 : (matchesCount?.total ?? 0);
      this.find.onResult?.({ index: count ? (matchesCount?.current ?? 1) - 1 : -1, count });
    };
    // The current page changes after scrolling settles; let the app re-sync the outline.
    eventBus.on("pagechanging", () => this.host.onScroll());
    eventBus.on("updatefindmatchescount", report);
    eventBus.on("updatefindcontrolstate", report);
    this.viewer = viewer;
    this.eventBus = eventBus;
    this.links = links;
  }

  async load(path: string, ctx: ViewContext): Promise<{ title?: string }> {
    const [{ pdfjs, documentOptions }, data] = await Promise.all([loadEngine(), backend.readBinary(path), this.setup()]);
    const task = pdfjs.getDocument({ ...documentOptions, data, docBaseUrl: toFileUrl(path) });
    const doc = await task.promise;
    const previous = this.task;
    this.task = task;
    this.doc = doc;
    const ready = new Promise<void>((resolve) => this.eventBus!.on("pagesinit", () => resolve(), { once: true }));
    this.viewer!.setDocument(doc);
    this.links!.setDocument(doc);
    await ready;
    void previous?.destroy();

    this.zoom = ctx.zoom;
    this.fit();
    this.items = await this.buildOutline(doc);
    const meta = await doc.getMetadata().catch(() => null);
    const title = (meta?.info as { Title?: string } | undefined)?.Title?.trim();
    return { title: title || undefined };
  }

  async refresh(ctx: ViewContext): Promise<void> {
    this.setZoom(ctx.zoom);
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    if (this.viewer && this.doc) this.viewer.currentScale = this.baseScale * zoom;
  }

  /** Supports PDF open parameters such as `#page=3` and named destinations. */
  scrollToFragment(fragment: string): boolean {
    if (!this.links || !fragment) return false;
    this.links.setHash(fragment);
    return true;
  }

  outline(): OutlineItem[] {
    return this.items;
  }

  position(): number {
    return (this.viewer?.currentPageNumber ?? 1) - 1;
  }

  async print(): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    document.getElementById("mdz-print")?.remove();
    const root = el("div", { id: "mdz-print" });
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = el("canvas", { width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) });
      await page.render({ canvas, viewport }).promise;
      root.append(el("img", { src: canvas.toDataURL("image/png") }));
    }
    document.body.append(root);
    document.body.classList.add("mdz-printing-pdf");
    window.addEventListener("afterprint", () => document.body.classList.remove("mdz-printing-pdf"), { once: true });
    await backend.printPage();
  }

  dispose(): void {
    this.find.clear();
    void this.task?.destroy();
    this.element.remove();
  }

  private async buildOutline(doc: PDFDocumentProxy): Promise<OutlineItem[]> {
    const tree = (await doc.getOutline().catch(() => null)) ?? [];
    const items: OutlineItem[] = [];
    const walk = async (nodes: OutlineNode[], level: number) => {
      for (const node of nodes) {
        const page = await this.pageIndexOf(doc, node.dest);
        items.push({
          title: node.title,
          level,
          position: page === null ? undefined : () => page,
          activate: () => {
            if (node.dest) void this.links!.goToDestination(node.dest);
            else if (node.url) this.host.followLink(node.url, false);
          },
        });
        await walk(node.items, level + 1);
      }
    };
    await walk(tree, 1);
    return items;
  }

  private async pageIndexOf(doc: PDFDocumentProxy, dest: OutlineNode["dest"]): Promise<number | null> {
    try {
      const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
      const ref = explicit?.[0];
      if (typeof ref === "number") return ref;
      return ref ? await doc.getPageIndex(ref) : null;
    } catch {
      return null;
    }
  }
}

export const pdfFormat: FormatPlugin = {
  id: "pdf",
  name: "PDF",
  description: "PDF documents (pdf.js): text selection, links, outline, find",
  extensions: ["pdf"],
  defaultEnabled: true,
  createView: (host) => new PdfView(host),
};
