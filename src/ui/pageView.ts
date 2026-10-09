// Page view: a document shown the way it would be printed with the current
// print settings (paper, pages per sheet, booklet, margins, scale, frames),
// with one or more sheets side by side.

import type { DocumentView, OrientationTarget, PrintPages } from "../formats/types";
import type { LocalException } from "../print/orientation";
import { bracketElement, hasMarks, labelElement, LabelRows, markSpecs, pageTag, type MarkAction } from "./orientationMarks";
import { impose, orientSides, pageSetup, sheetGeometry, type PrintOptions, type SheetGeometry, type Side } from "../print/imposition";
import { buildSheet } from "../print/printJob";
import { el } from "./overlay";

const PX_PER_MM = 96 / 25.4;
const GAP = 16;
const PADDING = 24;
const CAPTION = 22;

/** Sheets per row; 0 = as many as fit (each sheet as high as the window at 100 % zoom). */
export type PageColumns = 0 | 1 | 2 | 3 | 4;

/** Print options that change what the sheets look like (not the range or two-sided printing). */
export function pageViewKey(options: PrintOptions): string {
  const { layout, paper, orientation, scaleMode, scaleValue, alignH, alignV, margin, border, marginFrame, gutterMargin } = options;
  return JSON.stringify([layout, paper, orientation, scaleMode, scaleValue, alignH, alignV, margin, border, marginFrame, gutterMargin, pageSetup(options).key]);
}

interface SheetBox {
  side: Side;
  geo: SheetGeometry;
  box: HTMLElement;
  holder: HTMLElement;
  filled: boolean;
}

export interface PageViewHost {
  onScroll(): void;
  /** Right click on a page of a document with orientation notes. */
  pageMenu(target: OrientationTarget, x: number, y: number): void;
  /** Removes your exceptions that no longer match the document. */
  removeOrphans(orphans: LocalException[]): void;
  /** An action on an orientation mark, as in the continuous view. */
  orientation(action: MarkAction): void;
  /** Whether orientation marks are shown (▥ menu). */
  showMarks(): boolean;
}

export class PageView {
  readonly element = el("section", { className: "doc-view page-view", tabIndex: -1 });
  /** What decides the orientation of the pages (settings, markers, your exceptions). */
  private info = el("div", { className: "page-info" });
  private grid = el("div", { className: "page-grid" });
  private status = el("p", { className: "mdz-hint page-status" });
  private pages: PrintPages | null = null;
  private sheets: SheetBox[] = [];
  private options: PrintOptions | null = null;
  private token = 0;
  private columns: PageColumns = 0;
  private zoom = 1;
  private frame = 0;
  private observer: IntersectionObserver;
  /** Key of the options and document the sheets were built for. */
  key = "";

  constructor(private host: PageViewHost) {
    this.element.append(this.info, this.status, this.grid);
    this.info.hidden = true;
    this.element.addEventListener("scroll", () => host.onScroll());
    this.element.addEventListener("contextmenu", (e) => this.onContextMenu(e));
    // Sheets are filled only near the visible area; long documents would otherwise clone a lot of DOM.
    this.observer = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && this.fill(e.target as HTMLElement)), {
      root: this.element,
      rootMargin: "100% 0px",
    });
    new ResizeObserver(() => {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => this.layout());
    }).observe(this.element);
  }

  /** Lays the document out as printed sheets; `key` identifies the document version and options. */
  async build(view: DocumentView, options: PrintOptions, key: string): Promise<void> {
    if (!view.printPages) throw new Error("this document has no pages");
    const token = ++this.token;
    this.key = key;
    this.status.textContent = "Preparing pages…";
    this.status.hidden = false;
    // The same pages as the print dialog prepares.
    const setup = pageSetup(options);
    const pages = await view.printPages(
      setup.format,
      (done, total) => {
        if (token === this.token) this.status.textContent = `Preparing pages… ${done}/${total}`;
      },
      setup.layout,
    );
    if (token !== this.token) {
      pages.dispose();
      return;
    }
    const ratio = this.scrollRatio();
    this.release();
    this.pages = pages;
    this.options = { ...options };
    const isLandscape = (i: number) => pages.size(i).width > pages.size(i).height;
    const sides = impose([...Array(pages.count).keys()], options.layout);
    orientSides(sides, options.layout, options.orientation, isLandscape).forEach((o, i) => (sides[i].orientation = o));
    this.sheets = sides.map((side, i) => {
      const geo = sheetGeometry(options.layout, options.paper, side.orientation ?? "portrait");
      const holder = el("div", { className: "page-sheet" });
      const box = el("figure", { className: "page-box" }, holder, el("figcaption", { textContent: caption(side, i, options, pages) }));
      box.dataset.index = String(i);
      return { side, geo, box, holder, filled: false };
    });
    this.grid.replaceChildren(...this.sheets.map((s) => s.box));
    this.status.hidden = true;
    this.showInfo(pages);
    this.layout();
    this.element.scrollTop = ratio * this.element.scrollHeight;
    for (const s of this.sheets) this.observer.observe(s.box);
  }

  /** The lines explaining the orientation, and a way to drop exceptions that no longer match. */
  private showInfo(pages: PrintPages): void {
    const notes = pages.notes;
    this.info.hidden = !notes;
    if (!notes) return;
    const lines = notes.summary.map((line) => el("div", { textContent: line }));
    const hint = el("div", { className: "mdz-hint", textContent: "Right-click a page to turn it or add a marker; the labels beside the pages move or remove markers." });
    const parts: HTMLElement[] = [...lines, hint];
    if (notes.orphans.length) {
      const remove = el("button", { className: "mdz-settings-button", textContent: "Remove them" });
      remove.addEventListener("click", () => this.host.removeOrphans(notes.orphans));
      parts.splice(lines.length, 0, el("div", {}, remove));
    }
    this.info.replaceChildren(...parts);
  }

  private onContextMenu(e: MouseEvent): void {
    const notes = this.pages?.notes;
    const box = (e.target as Element).closest<HTMLElement>(".page-box");
    if (!notes || !box) return;
    const side = this.sheets[Number(box.dataset.index)]?.side;
    if (!side) return;
    // The page under the pointer when a sheet holds several.
    const slot = (e.target as Element).closest(".mdz-slot");
    const slots = slot ? [...slot.parentElement!.querySelectorAll(":scope > .mdz-slot")] : [];
    const page = side.slots[Math.max(0, slots.indexOf(slot!))] ?? side.slots.find((s) => s !== null);
    // The block under the pointer, like in the continuous view; on the margins the page's deciding block.
    const block = (e.target as Element).closest<HTMLElement>(".mdz-md-clip > .markdown-body > [data-mdz-block]");
    const target =
      page === null || page === undefined ? null : block ? notes.blockTarget(Number(block.dataset.mdzBlock), page) : notes.target(page);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    this.host.pageMenu(target, e.clientX, e.clientY);
  }

  setLayout(columns: PageColumns, zoom: number): void {
    if (columns === this.columns && zoom === this.zoom) return;
    this.columns = columns;
    this.zoom = zoom;
    this.layout();
  }

  private scrollRatio(): number {
    return this.element.scrollHeight > 0 ? this.element.scrollTop / this.element.scrollHeight : 0;
  }

  /** Sizes all sheets with one common scale, so equal paper looks equal. */
  private layout(): void {
    if (!this.sheets.length || !this.element.clientWidth) return;
    const ratio = this.scrollRatio();
    const widest = Math.max(...this.sheets.map((s) => s.geo.width));
    const tallest = Math.max(...this.sheets.map((s) => s.geo.height));
    const width = this.element.clientWidth - 2 * PADDING;
    const height = this.element.clientHeight - 2 * PADDING - CAPTION;
    const fit = this.columns
      ? (width - GAP * (this.columns - 1)) / (this.columns * widest)
      : Math.min(height / tallest, width / widest);
    const pxPerMm = Math.max(0.2, fit * this.zoom);
    this.grid.style.gridTemplateColumns = this.columns ? `repeat(${this.columns}, max-content)` : "";
    this.grid.classList.toggle("auto", !this.columns);
    for (const s of this.sheets) {
      Object.assign(s.holder.style, { width: `${s.geo.width * pxPerMm}px`, height: `${s.geo.height * pxPerMm}px` });
      const sheet = s.holder.firstElementChild as HTMLElement | null;
      if (sheet) sheet.style.transform = `scale(${pxPerMm / PX_PER_MM})`;
    }
    this.element.scrollTop = ratio * this.element.scrollHeight;
    for (const s of this.sheets) if (s.filled) this.drawMarks(s);
  }

  /**
   * Orientation marks over a sheet, like in the continuous view: brackets beside
   * the parts of blocks on each page, labels where a block starts. Drawn over the
   * sheet on screen only; the printed pages are built separately.
   */
  private drawMarks(s: SheetBox): void {
    s.box.querySelector(":scope > .mdz-orient-layer")?.remove();
    const notes = this.pages?.notes;
    if (!notes || !this.host.showMarks()) return;
    const data = { blocks: notes.blocks, marks: notes.marks, turnable: notes.turnable, pageStarts: notes.pageStarts };
    if (!hasMarks(data)) return;
    const layer = el("div", { className: "mdz-orient-layer page" });
    const origin = s.box.getBoundingClientRect();
    const parts: HTMLElement[] = [];
    // Labels go beside the sheet when there is room there, otherwise onto the page above the block.
    // Free room left of the sheet: up to the sheet beside it in the same row, or the edge of the view.
    let edge = this.element.getBoundingClientRect().left;
    for (const other of this.sheets) {
      const r = other.box.getBoundingClientRect();
      if (other !== s && Math.abs(r.top - origin.top) < 4 && r.right <= origin.left + 1) edge = Math.max(edge, r.right);
    }
    const beside = origin.left - edge >= 260;
    const rows = new LabelRows(parts, beside ? -Infinity : Infinity);
    const { brackets, labels } = markSpecs(data);
    // The pages on this sheet, in the order of its slots.
    const shownPages = s.side.slots.filter((x): x is number => x !== null);
    [...s.holder.querySelectorAll<HTMLElement>(".mdz-md-page")].forEach((page, n) => {
      const clip = [...page.querySelectorAll<HTMLElement>(":scope > .mdz-md-clip")].pop();
      const index = shownPages[n];
      if (!clip || index === undefined) return;
      // A grey tag per page, to turn it with one click, like the page lines of the continuous view.
      const size = this.pages!.size(index);
      const start = index === 0 ? { page: 1, block: 0, fraction: 0, cause: "auto" as const, landscape: false } : data.pageStarts[index - 1];
      const tag = start && pageTag(data, { ...start, landscape: size.width > size.height });
      if (tag) {
        const area = clip.getBoundingClientRect();
        rows.add(labelElement(tag, (action) => this.host.orientation(action)), area.top - origin.top, beside ? 22 : area.left - origin.left);
      }
    });
    for (const page of s.holder.querySelectorAll<HTMLElement>(".mdz-md-page")) {
      // The last window shows the page; a first one may repeat table headers.
      const clip = [...page.querySelectorAll<HTMLElement>(":scope > .mdz-md-clip")].pop();
      if (!clip) continue;
      const area = clip.getBoundingClientRect();
      const pieces = new Map<number, DOMRect>();
      for (const block of clip.querySelectorAll<HTMLElement>(":scope > .markdown-body > [data-mdz-block]")) {
        const r = block.getBoundingClientRect();
        if (r.bottom > area.top + 0.5 && r.top < area.bottom - 0.5) pieces.set(Number(block.dataset.mdzBlock), r);
      }
      if (!pieces.size) continue;
      const lastBlock = Math.max(...pieces.keys());
      for (const b of brackets) {
        const shown = [...pieces].filter(([i]) => i >= b.from && i <= b.to).map(([, r]) => r);
        if (!shown.length) continue;
        const top = Math.max(area.top, Math.min(...shown.map((r) => r.top)));
        const bottom = Math.min(area.bottom, Math.max(...shown.map((r) => r.bottom)));
        const left = Math.min(area.left, ...shown.map((r) => r.left)) - 6 - b.lane * 5;
        if (bottom > top) parts.push(bracketElement(b, top - origin.top, bottom - top, left - origin.left));
      }
      for (const l of labels) {
        const r = pieces.get(l.at);
        const end = l.at === data.blocks.length && pieces.get(lastBlock) && lastBlock === data.blocks.length - 1 ? pieces.get(lastBlock)! : null;
        // A label belongs where its block starts (or below the last block of the document).
        const top = r && r.top >= area.top - 1 ? r.top : end && end.bottom <= area.bottom + 1 ? end.bottom : null;
        if (top === null) continue;
        rows.add(labelElement(l, (action) => this.host.orientation(action)), top - origin.top, beside ? 22 : area.left - origin.left);
      }
    }
    layer.replaceChildren(...parts);
    s.box.append(layer);
  }

  /** Redraws the marks (after the setting changed). */
  refreshMarks(): void {
    for (const s of this.sheets) if (s.filled) this.drawMarks(s);
  }

  private fill(box: HTMLElement): void {
    const s = this.sheets[Number(box.dataset.index)];
    if (!s || s.filled || !this.pages || !this.options) return;
    s.filled = true;
    const sheet = buildSheet(s.side, s.geo, this.pages, this.options);
    sheet.style.transformOrigin = "0 0";
    const pxPerMm = parseFloat(s.holder.style.width) / s.geo.width;
    sheet.style.transform = `scale(${pxPerMm / PX_PER_MM})`;
    s.holder.replaceChildren(sheet);
    // Measured once the sheet is laid out.
    requestAnimationFrame(() => this.drawMarks(s));
  }

  private release(): void {
    this.observer.disconnect();
    this.pages?.dispose();
    this.pages = null;
    this.sheets = [];
  }

  dispose(): void {
    this.token++;
    this.release();
    this.element.remove();
  }
}

function caption(side: Side, index: number, options: PrintOptions, source: PrintPages): string {
  const shown = side.slots.filter((s): s is number => s !== null);
  const pages = shown.map((n) => n + 1);
  const what = pages.length === 0 ? "blank" : pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.join(", ")}`;
  // Why a page is turned (or kept) when it is not simply following the paper.
  const notes = shown.map((n) => [n + 1, source.notes?.page(n) ?? ""] as const).filter(([, note]) => note);
  const why = notes.length ? ` · ${notes.map(([n, note]) => (shown.length > 1 ? `p. ${n} ${note}` : note)).join("; ")}` : "";
  if (options.layout === "booklet" || options.duplex !== "none") return `Sheet ${Math.floor(index / 2) + 1}, ${index % 2 ? "back" : "front"} · ${what}${why}`;
  return options.layout === "1" ? `Page ${pages[0]}${why}` : `Sheet ${index + 1} · ${what}${why}`;
}
