import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import type { EventBus, PDFFindController, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import * as backend from "../backend";
import { toFileUrl } from "../paths";
import { cropText, validCrop, type Crop, type DocExceptions } from "../print/orientation";
import { showContextMenu } from "../ui/contextMenu";
import { el } from "../ui/overlay";
import type { DocumentView, FindProvider, FormatPlugin, OutlineItem, PrintPages, ViewContext, ViewHost } from "./types";

type Engine = typeof import("./pdfEngine");
let engine: Promise<Engine> | undefined;
const loadEngine = () => (engine ??= import("./pdfEngine"));

type OutlineNode = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>[number];

/** Your view settings per document (the crop windows), from the config. */
let exceptions: Record<string, DocExceptions> = {};
const views = new Set<PdfView>();

/**
 * Renders a page and cuts the crop window out of it (fractions of the page),
 * as a PNG object URL; the size is that of the window in mm.
 */
async function renderPage(doc: PDFDocumentProxy, n: number, crop: Crop | null): Promise<{ url: string; size: { width: number; height: number } }> {
  const MM_PER_PT = 25.4 / 72;
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: 2.6 });
  const canvas = el("canvas", { width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) });
  await page.render({ canvas, viewport }).promise;
  let out = canvas;
  if (crop) {
    const sx = Math.round(crop.x * canvas.width);
    const sy = Math.round(crop.y * canvas.height);
    const sw = Math.max(1, Math.round(crop.width * canvas.width));
    const sh = Math.max(1, Math.round(crop.height * canvas.height));
    out = el("canvas", { width: sw, height: sh });
    out.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  }
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
  const scale = crop ? { width: crop.width, height: crop.height } : { width: 1, height: 1 };
  return {
    url: blob ? URL.createObjectURL(blob) : "",
    size: { width: base.width * MM_PER_PT * scale.width, height: base.height * MM_PER_PT * scale.height },
  };
}

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
  private path = "";
  /** Set by a print project: its crop window instead of the document's own (null = none). */
  cropOverride?: Crop | null;
  /** Says that the printed pages show only the crop window. */
  private cropInfo = el("div", { className: "pdf-crop-info" });
  /** Drawing a crop window: the hint, and how to stop. */
  private drawing: { stop: () => void } | null = null;

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
    this.element.append(this.pages, this.cropInfo);
    this.cropInfo.hidden = true;
    views.add(this);
    this.element.addEventListener("scroll", () => host.onScroll());
    this.element.addEventListener("contextmenu", (e) => {
      if (!host.crop || this.drawing) return;
      e.preventDefault();
      this.cropMenu(e.clientX, e.clientY);
    });
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
    let scale = this.viewer.currentScale;
    // "auto" fits the current page; documents mixing portrait and landscape pages must fit the widest one.
    let widest = 0;
    for (let i = 0; i < this.viewer.pagesCount; i++) {
      const viewport = this.viewer.getPageView(i)?.viewport;
      // viewport.scale includes the PDF-point-to-CSS-pixel factor (96/72); widest is in CSS px at scale 1.
      if (viewport) widest = Math.max(widest, (viewport.width / viewport.scale) * (96 / 72));
    }
    const available = this.element.clientWidth - 40;
    if (widest * scale > available) scale = available / widest;
    this.baseScale = scale;
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
    // pdf.js empties a page when it renders it again: the crop frame is put back.
    eventBus.on("pagerendered", ({ source }: { source: { div: HTMLElement } }) => this.cropFrame(source.div));
    eventBus.on("updatefindmatchescount", report);
    eventBus.on("updatefindcontrolstate", report);
    this.viewer = viewer;
    this.eventBus = eventBus;
    this.links = links;
  }

  async load(path: string, ctx: ViewContext): Promise<{ title?: string }> {
    const [{ pdfjs, documentOptions }, data] = await Promise.all([loadEngine(), backend.readBinary(path), this.setup()]);
    this.path = path;
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
    this.showCrop();
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

  /** The crop window of the pages: a print project's, else your own for the document. */
  crop(): Crop | null {
    if (this.cropOverride !== undefined) return this.cropOverride;
    return validCrop(exceptions[this.path]?.crop);
  }

  /** Renders every page (or its crop window) to an image at print resolution (about 190 dpi). */
  async printPages(_paper: unknown, onProgress?: (done: number, total: number) => void): Promise<PrintPages> {
    const doc = this.doc;
    if (!doc) throw new Error("document not loaded");
    const crop = this.crop();
    const urls: string[] = [];
    const sizes: { width: number; height: number }[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const { url, size } = await renderPage(doc, n, crop);
      urls.push(url);
      sizes.push(size);
      onProgress?.(n, doc.numPages);
    }
    return {
      count: urls.length,
      size: (index) => sizes[index],
      render: (index) => el("img", { className: "mdz-pdf-page", src: urls[index], alt: `Page ${index + 1}` }),
      dispose: () => urls.forEach((url) => URL.revokeObjectURL(url)),
    };
  }

  /** Shows the crop window on every page and says what it does. */
  showCrop(): void {
    const crop = this.crop();
    this.cropInfo.hidden = !crop;
    if (crop) this.cropInfo.textContent = `Crop window: ${cropText(crop)}. Printed pages and the page view show only this window of every page. Right-click to change it.`;
    for (const page of this.pages.querySelectorAll<HTMLElement>(".page")) this.cropFrame(page);
  }

  private cropFrame(page: HTMLElement): void {
    page.querySelector(":scope > .mdz-crop-frame")?.remove();
    const crop = this.crop();
    if (!crop) return;
    const frame = el("div", { className: "mdz-crop-frame" });
    Object.assign(frame.style, { left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` });
    page.append(frame);
  }

  private cropMenu(x: number, y: number): void {
    const crop = validCrop(exceptions[this.path]?.crop);
    showContextMenu(x, y, [
      { label: "Crop window", detail: crop ? cropText(crop) : "None: whole pages are printed", disabled: true, action: () => {} },
      null,
      {
        label: crop ? "Draw a new crop window…" : "Draw a crop window…",
        detail: "Drag a rectangle on any page; the same window of every page is printed, each as a page",
        action: () => this.drawCrop(),
      },
      { label: "Remove the crop window", detail: "Whole pages are printed again", disabled: !crop, action: () => this.host.crop?.(null) },
    ]);
  }

  /** Lets the user drag a rectangle on a page; Esc cancels. */
  drawCrop(): void {
    this.drawing?.stop();
    // The hint uses the bar of the crop window (pdf.js wants its pages first in the view).
    this.cropInfo.hidden = false;
    this.cropInfo.textContent = "Drag a rectangle on a page: that window of every page will be printed. Esc cancels.";
    this.element.classList.add("mdz-cropping");
    let rect: HTMLElement | null = null;
    const stop = () => {
      this.element.classList.remove("mdz-cropping");
      rect?.remove();
      this.drawing = null;
      this.showCrop();
      this.element.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      stop();
    };
    const down = (e: PointerEvent) => {
      const page = (e.target as Element).closest<HTMLElement>(".page");
      if (!page || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      // The page without its border.
      const box = page.getBoundingClientRect();
      const left = box.left + page.clientLeft;
      const top = box.top + page.clientTop;
      const at = (ev: PointerEvent) => ({
        x: Math.min(Math.max((ev.clientX - left) / page.clientWidth, 0), 1),
        y: Math.min(Math.max((ev.clientY - top) / page.clientHeight, 0), 1),
      });
      const start = at(e);
      rect = el("div", { className: "mdz-crop-frame drawing" });
      page.append(rect);
      const current = (ev: PointerEvent): Crop => {
        const end = at(ev);
        return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
      };
      const move = (ev: PointerEvent) => {
        const c = current(ev);
        Object.assign(rect!.style, { left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.width * 100}%`, height: `${c.height * 100}%` });
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        const crop = validCrop(current(ev));
        stop();
        if (crop) this.host.crop?.(crop);
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
    };
    this.element.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    this.drawing = { stop };
  }

  dispose(): void {
    this.drawing?.stop();
    views.delete(this);
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
  configure(config) {
    exceptions = config.pageExceptions ?? {};
    for (const view of views) view.showCrop();
  },
  createView: (host) => new PdfView(host),
};
