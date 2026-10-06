// Page view: a document shown the way it would be printed with the current
// print settings (paper, pages per sheet, booklet, margins, scale, frames),
// with one or more sheets side by side.

import type { DocumentView, PrintPages } from "../formats/types";
import { PAPERS, impose, orientSides, sheetGeometry, type PrintOptions, type SheetGeometry, type Side } from "../print/imposition";
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
  return JSON.stringify([layout, paper, orientation, scaleMode, scaleValue, alignH, alignV, margin, border, marginFrame, gutterMargin]);
}

interface SheetBox {
  side: Side;
  geo: SheetGeometry;
  box: HTMLElement;
  holder: HTMLElement;
  filled: boolean;
}

export class PageView {
  readonly element = el("section", { className: "doc-view page-view", tabIndex: -1 });
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

  constructor(onScroll: () => void) {
    this.element.append(this.status, this.grid);
    this.element.addEventListener("scroll", onScroll);
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
    const paper = PAPERS[options.paper];
    // Like the print dialog: Markdown printed one page per landscape sheet is paginated for the landscape width.
    const wide = options.layout === "1" && options.orientation === "landscape";
    const pages = await view.printPages(wide ? { width: paper.height, height: paper.width } : paper, (done, total) => {
      if (token === this.token) this.status.textContent = `Preparing pages… ${done}/${total}`;
    });
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
      const box = el("figure", { className: "page-box" }, holder, el("figcaption", { textContent: caption(side, i, options) }));
      box.dataset.index = String(i);
      return { side, geo, box, holder, filled: false };
    });
    this.grid.replaceChildren(...this.sheets.map((s) => s.box));
    this.status.hidden = true;
    this.layout();
    this.element.scrollTop = ratio * this.element.scrollHeight;
    for (const s of this.sheets) this.observer.observe(s.box);
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

function caption(side: Side, index: number, options: PrintOptions): string {
  const pages = side.slots.filter((s): s is number => s !== null).map((n) => n + 1);
  const what = pages.length === 0 ? "blank" : pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.join(", ")}`;
  if (options.layout === "booklet" || options.duplex !== "none") return `Sheet ${Math.floor(index / 2) + 1}, ${index % 2 ? "back" : "front"} · ${what}`;
  return options.layout === "1" ? `Page ${pages[0]}` : `Sheet ${index + 1} · ${what}`;
}
