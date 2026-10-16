import { describe, expect, it, vi } from "vitest";
import type { SheetState } from "../formats/sheets";
import { ColumnSlider, SLIDER_IDLE_MS } from "./columnSlider";

/** A sheet of columns A–J, 100 px each, showing C–E. */
const sheet = {
  key: "sheet:Data",
  name: "Data",
  columns: [...Array(10).keys()].map((c) => ({ c, width: 100 })),
  cols: [2, 4],
  rows: [0, 9],
} as unknown as SheetState;

/** A slider 1000 px wide at x = 0, so each column is 100 px. */
function slider() {
  const chosen: number[][] = [];
  const s = new ColumnSlider((_, first, last) => chosen.push([first, last]), () => {});
  const strip = s.element.querySelector<HTMLElement>(".mdz-colslider-strip")!;
  strip.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, right: 1000, bottom: 18, height: 18, x: 0, y: 0, toJSON: () => ({}) });
  s.show(sheet);
  return { s, chosen };
}

/** Drags `element` from x `from` to x `to`. */
function drag(element: HTMLElement, from: number, to: number): void {
  element.setPointerCapture = () => {};
  const event = (type: string, x: number) => Object.assign(new MouseEvent(type, { clientX: x, button: 0, bubbles: true }), { pointerId: 1 });
  element.dispatchEvent(event("pointerdown", from));
  element.dispatchEvent(event("pointermove", to));
  element.dispatchEvent(event("pointerup", to));
}

describe("column slider", () => {
  it("shows the columns shown between the stops", () => {
    const { s } = slider();
    const band = s.element.querySelector<HTMLElement>(".mdz-colslider-band")!;
    expect([band.style.left, band.style.width]).toEqual(["20%", "30%"]);
    expect(s.key).toBe("sheet:Data");
  });

  it("moves an edge to the nearest column edge", () => {
    const { s, chosen } = slider();
    const [left, right] = s.element.querySelectorAll<HTMLElement>(".mdz-ruler-stop");
    drag(left, 200, 120);
    drag(right, 500, 780);
    expect(chosen).toEqual([
      [1, 4],
      [1, 7],
    ]);
  });

  it("moves the whole part, never past the sheet", () => {
    const { s, chosen } = slider();
    const band = s.element.querySelector<HTMLElement>(".mdz-colslider-band")!;
    drag(band, 350, 550);
    drag(band, 550, 990);
    expect(chosen).toEqual([
      [4, 6],
      [7, 9],
    ]);
  });

  it("hides itself when left alone or when the document scrolls", () => {
    vi.useFakeTimers();
    try {
      const { s } = slider();
      vi.advanceTimersByTime(SLIDER_IDLE_MS + 1);
      expect(s.key).toBeUndefined();
      // While the pointer is over it, it stays, also when the document scrolls.
      s.show(sheet);
      s.element.dispatchEvent(new MouseEvent("pointerenter"));
      vi.advanceTimersByTime(SLIDER_IDLE_MS * 2);
      s.scrolled();
      expect(s.key).toBe("sheet:Data");
      s.element.dispatchEvent(new MouseEvent("pointerleave"));
      vi.advanceTimersByTime(100);
      s.scrolled();
      // Scrolling right after it showed is the view settling.
      s.show(sheet);
      s.scrolled();
      expect(s.key).toBe("sheet:Data");
      vi.advanceTimersByTime(600);
      s.scrolled();
      expect(s.key).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
