// Width ruler at the top of the Markdown view: two pairs of stops, one for the
// text column and one for wide objects (tables, diagrams, images). Dragging a
// stop changes the width symmetrically around the centre; double-click resets.

import { DEFAULT_TEXT_WIDTH, MIN_TEXT_WIDTH, VIEW_GAP, type Widths } from "../formats/wideObjects";
import { el } from "./overlay";

/** Object width meaning "as wide as the view allows". */
export const FULL_WIDTH = 100000;

export interface RulerHost {
  widths(): Widths;
  zoom(): number;
  /** Left edge and width of the text content in viewport px. */
  textBox(): { left: number; width: number } | null;
  /** Live change while dragging; `done` on release. */
  change(widths: Widths, done: boolean): void;
}

export class Ruler {
  readonly element = el("div", { className: "mdz-ruler" });
  private textBand = el("div", { className: "mdz-ruler-text" });
  private objectBand = el("div", { className: "mdz-ruler-objects" });
  private label = el("span", { className: "mdz-ruler-label" });
  private stops: { text: HTMLElement[]; objects: HTMLElement[] };

  constructor(private view: HTMLElement, private host: RulerHost) {
    const stop = (kind: "text" | "objects", side: "left" | "right") => {
      const handle = el("div", { className: `mdz-ruler-stop ${kind} ${side}` });
      handle.addEventListener("pointerdown", (e) => this.drag(kind, handle, e));
      handle.addEventListener("dblclick", () => this.reset(kind));
      return handle;
    };
    this.stops = { text: [stop("text", "left"), stop("text", "right")], objects: [stop("objects", "left"), stop("objects", "right")] };
    this.element.append(this.objectBand, this.textBand, ...this.stops.objects, ...this.stops.text, this.label);
    this.label.hidden = true;
  }

  /** Repositions the stops after a resize, zoom or width change. */
  update(): void {
    const text = this.host.textBox();
    if (!text) return;
    const origin = this.view.getBoundingClientRect().left;
    const centre = text.left - origin + text.width / 2;
    const widths = this.host.widths();
    const zoom = this.host.zoom();
    const room = this.view.clientWidth - 2 * VIEW_GAP;
    const objects = Math.max(text.width, Math.min(widths.objects * zoom, room));
    const place = (band: HTMLElement, stops: HTMLElement[], width: number, title: string) => {
      band.style.left = `${centre - width / 2}px`;
      band.style.width = `${width}px`;
      stops[0].style.left = `${centre - width / 2}px`;
      stops[1].style.left = `${centre + width / 2}px`;
      for (const s of stops) s.title = title;
    };
    place(this.textBand, this.stops.text, text.width, `Text width ${Math.round(widths.text)} px — drag to change, double-click to reset`);
    const objectsTitle = widths.objects >= FULL_WIDTH ? "as wide as the window" : `${Math.round(widths.objects)} px`;
    place(this.objectBand, this.stops.objects, objects, `Widest tables, diagrams and images: ${objectsTitle} — drag to change, double-click to reset to the text width`);
  }

  private reset(kind: "text" | "objects"): void {
    const widths = this.host.widths();
    const next = kind === "text" ? { text: DEFAULT_TEXT_WIDTH, objects: Math.max(widths.objects, DEFAULT_TEXT_WIDTH) } : { ...widths, objects: widths.text };
    this.host.change(next, true);
  }

  private drag(kind: "text" | "objects", handle: HTMLElement, down: PointerEvent): void {
    down.preventDefault();
    handle.setPointerCapture(down.pointerId);
    const text = this.host.textBox();
    if (!text) return;
    const centre = text.left + text.width / 2;
    const zoom = this.host.zoom();
    const room = this.view.clientWidth - 2 * VIEW_GAP;
    this.label.hidden = false;
    let current = this.host.widths();
    const move = (e: PointerEvent) => {
      const span = 2 * Math.abs(e.clientX - centre);
      const widths = this.host.widths();
      if (kind === "text") {
        const value = Math.max(MIN_TEXT_WIDTH, Math.round(span / zoom));
        current = { text: value, objects: Math.max(widths.objects, value) };
        this.label.textContent = `Text ${value} px`;
      } else {
        // Dragged (almost) to the edge of the view: as wide as the window, whatever its size.
        const full = span >= room - 4;
        const value = full ? FULL_WIDTH : Math.max(widths.text, Math.round(span / zoom));
        current = { ...widths, objects: value };
        this.label.textContent = full ? "Objects: window width" : `Objects ${value} px`;
      }
      this.label.style.left = `${e.clientX - this.view.getBoundingClientRect().left + 12}px`;
      this.host.change(current, false);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      this.label.hidden = true;
      this.host.change(current, true);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }
}
