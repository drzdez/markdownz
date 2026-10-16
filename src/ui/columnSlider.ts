// Column slider of an Excel sheet: a strip with all columns of the sheet and
// two stops, like the width ruler, for the first and last column shown on
// screen and paper. Dragging a stop moves that edge, dragging the band between
// them moves the whole part; stops snap to the column edges. Double-click
// shows all columns. The rows shown stay as they are. It hides itself a few
// seconds after you leave it, or when the document scrolls.

import { columnName, type SheetState } from "../formats/sheets";
import { el } from "./overlay";

/** The slider hides this long after the pointer left it. */
export const SLIDER_IDLE_MS = 4000;

export class ColumnSlider {
  readonly element = el("div", { className: "mdz-colslider" });
  private name = el("span", { className: "mdz-colslider-name" });
  private strip = el("div", { className: "mdz-colslider-strip" });
  private cells = el("div", { className: "mdz-colslider-cells" });
  private band = el("div", { className: "mdz-colslider-band" });
  private stops = [el("div", { className: "mdz-ruler-stop text left" }), el("div", { className: "mdz-ruler-stop text right" })];
  private label = el("span", { className: "mdz-ruler-label" });
  private sheet: SheetState | null = null;
  /** Indexes into the sheet's columns of the first and last column shown. */
  private first = 0;
  private last = 0;
  /** Left edges of the columns in % of the strip, and 100 at the end. */
  private edges: number[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private hovering = false;
  private dragging = false;
  /** When it was shown: scrolling right after that is the view settling, not you. */
  private shownAt = 0;

  constructor(
    /** You chose columns `first`–`last` (column numbers of the sheet). */
    private done: (sheet: SheetState, first: number, last: number) => void,
    /** The ✕ button. */
    closed: () => void,
  ) {
    const close = el("button", { type: "button", className: "mdz-colslider-close", textContent: "✕", title: "Hide the column slider" });
    close.addEventListener("click", closed);
    this.strip.append(this.cells, this.band, ...this.stops, this.label);
    this.element.append(this.name, this.strip, close);
    this.element.hidden = true;
    this.label.hidden = true;
    this.stops[0].addEventListener("pointerdown", (e) => this.drag(e, "first"));
    this.stops[1].addEventListener("pointerdown", (e) => this.drag(e, "last"));
    this.band.addEventListener("pointerdown", (e) => this.drag(e, "both"));
    this.strip.addEventListener("dblclick", () => {
      const sheet = this.sheet;
      if (sheet) this.done(sheet, sheet.columns[0].c, sheet.columns[sheet.columns.length - 1].c);
    });
    for (const stop of this.stops) stop.title = "Drag to choose the first or last column; double-click for all columns";
    this.band.title = "Drag to move the part shown; double-click for all columns";
    this.element.addEventListener("pointerenter", () => {
      this.hovering = true;
      clearTimeout(this.timer);
    });
    this.element.addEventListener("pointerleave", () => {
      this.hovering = false;
      this.idle();
    });
  }

  /** Hides the slider after a while unless you use it. */
  private idle(): void {
    clearTimeout(this.timer);
    if (!this.hovering && !this.dragging && !this.element.hidden) this.timer = setTimeout(() => this.hide(), SLIDER_IDLE_MS);
  }

  /** The document scrolled: the slider goes unless you are using it. */
  scrolled(): void {
    if (!this.hovering && !this.dragging && performance.now() - this.shownAt > 500) this.hide();
  }

  /** The sheet whose columns are shown, or none. */
  get key(): string | undefined {
    return this.element.hidden ? undefined : this.sheet?.key;
  }

  show(sheet: SheetState): void {
    this.sheet = sheet;
    const total = sheet.columns.reduce((sum, c) => sum + c.width, 0) || 1;
    let left = 0;
    this.edges = sheet.columns.map((c) => {
      const edge = (left / total) * 100;
      left += c.width;
      return edge;
    });
    this.edges.push(100);
    this.cells.replaceChildren(
      ...sheet.columns.map((c, i) => {
        const cell = el("span", { textContent: columnName(c.c) });
        cell.style.width = `${this.edges[i + 1] - this.edges[i]}%`;
        return cell;
      }),
    );
    const index = (col: number) => Math.max(0, sheet.columns.findIndex((c) => c.c === col));
    this.first = index(sheet.cols[0]);
    this.last = Math.max(this.first, index(sheet.cols[1]));
    this.name.textContent = `Columns of “${sheet.name}”`;
    if (this.element.hidden) this.shownAt = performance.now();
    this.element.hidden = false;
    this.place();
    this.idle();
  }

  hide(): void {
    clearTimeout(this.timer);
    this.element.hidden = true;
  }

  private text(): string {
    const columns = this.sheet!.columns;
    return `${columnName(columns[this.first].c)}:${columnName(columns[this.last].c)}`;
  }

  private place(): void {
    const [left, right] = [this.edges[this.first], this.edges[this.last + 1]];
    this.band.style.left = `${left}%`;
    this.band.style.width = `${right - left}%`;
    this.stops[0].style.left = `${left}%`;
    this.stops[1].style.left = `${right}%`;
    this.label.style.left = `${left}%`;
    this.label.textContent = this.text();
    this.band.title = `Columns ${this.text()}: drag to move the part shown; double-click for all columns`;
  }

  /** The column edge (0 … number of columns) nearest to x. */
  private edgeAt(x: number): number {
    const box = this.strip.getBoundingClientRect();
    const at = ((x - box.left) / Math.max(1, box.width)) * 100;
    let best = 0;
    for (let i = 1; i < this.edges.length; i++) if (Math.abs(this.edges[i] - at) < Math.abs(this.edges[best] - at)) best = i;
    return best;
  }

  /** The column under x. */
  private columnAt(x: number): number {
    const box = this.strip.getBoundingClientRect();
    const at = ((x - box.left) / Math.max(1, box.width)) * 100;
    const i = this.edges.findIndex((edge) => edge > at) - 1;
    return i < 0 ? (at <= 0 ? 0 : this.edges.length - 2) : i;
  }

  private drag(down: PointerEvent, what: "first" | "last" | "both"): void {
    const sheet = this.sheet;
    if (!sheet || down.button !== 0) return;
    down.preventDefault();
    const target = down.currentTarget as HTMLElement;
    target.setPointerCapture(down.pointerId);
    const count = sheet.columns.length;
    const start = { first: this.first, last: this.last, column: this.columnAt(down.clientX) };
    this.label.hidden = false;
    this.dragging = true;
    clearTimeout(this.timer);
    const move = (e: PointerEvent) => {
      if (what === "first") this.first = Math.min(this.edgeAt(e.clientX), this.last);
      else if (what === "last") this.last = Math.max(this.edgeAt(e.clientX) - 1, this.first);
      else {
        const shift = Math.max(-start.first, Math.min(count - 1 - start.last, this.columnAt(e.clientX) - start.column));
        this.first = start.first + shift;
        this.last = start.last + shift;
      }
      this.place();
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      this.label.hidden = true;
      this.dragging = false;
      this.idle();
      if (this.first !== start.first || this.last !== start.last) this.done(sheet, sheet.columns[this.first].c, sheet.columns[this.last].c);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }
}
