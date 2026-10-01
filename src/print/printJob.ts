import mdLight from "github-markdown-css/github-markdown-light.css?inline";
import hlLight from "highlight.js/styles/github.css?inline";
import * as backend from "../backend";
import type { PrintPages } from "../formats/types";
import { el } from "../ui/overlay";
import { PAPERS, SLOT_GAP, placePage, sheetGeometry, slotSize, type PrintOptions, type Side, type SheetGeometry } from "./imposition";

/** Options that shape a single sheet. */
export type SheetOptions = Pick<PrintOptions, "margin" | "scaleMode" | "scaleValue" | "alignH" | "alignV" | "border" | "marginFrame">;

/**
 * Paper is always light, whatever the app theme: the light GitHub styles are
 * scoped to `.mdz-paper` so they win over the dark theme on screen and in print.
 */
export function ensurePaperStyle(): void {
  if (document.getElementById("mdz-paper-style")) return;
  const scope = (css: string) =>
    css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .map((rule) => {
        const brace = rule.indexOf("{");
        if (brace < 0) return "";
        const selectors = rule
          .slice(0, brace)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => `.mdz-paper ${s}`)
          .join(", ");
        return `${selectors} {${rule.slice(brace + 1)}}`;
      })
      .join("\n");
  const style = el("style", { id: "mdz-paper-style", textContent: scope(mdLight) + scope(hlLight) });
  document.head.append(style);
}

/** Builds one sheet side with its pages scaled and aligned into the slots. */
export function buildSheet(side: Side, geo: SheetGeometry, pages: PrintPages, options: SheetOptions): HTMLElement {
  ensurePaperStyle();
  const sheet = el("div", { className: "mdz-sheet mdz-paper" });
  Object.assign(sheet.style, {
    width: `${geo.width}mm`,
    height: `${geo.height}mm`,
    padding: `${options.margin}mm`,
    gap: `${SLOT_GAP}mm`,
    gridTemplateColumns: `repeat(${geo.cols}, 1fr)`,
    gridTemplateRows: `repeat(${geo.rows}, 1fr)`,
  });
  if (options.marginFrame) {
    const frame = el("div", { className: "mdz-margin-frame" });
    frame.style.inset = `${options.margin}mm`;
    sheet.append(frame);
  }
  const slotMm = slotSize(geo, options.margin);
  for (const index of side.slots) {
    const slot = el("div", { className: "mdz-slot" });
    if (index !== null) {
      const size = pages.size(index);
      const at = placePage(slotMm, size, options.scaleMode, options.scaleValue, options.alignH, options.alignV);
      const frame = el("div", { className: "mdz-page-frame" });
      Object.assign(frame.style, { left: `${at.x}mm`, top: `${at.y}mm`, width: `${at.width}mm`, height: `${at.height}mm` });
      const page = pages.render(index);
      Object.assign(page.style, {
        width: `${size.width}mm`,
        height: `${size.height}mm`,
        transform: `scale(${at.scale})`,
        transformOrigin: "0 0",
      });
      frame.append(page);
      if (options.border) frame.append(el("div", { className: "mdz-page-border" }));
      slot.append(frame);
    }
    sheet.append(slot);
  }
  return sheet;
}

/**
 * Sends the given sides to the system print dialog, one sheet side per printed
 * page. The print job always uses portrait paper; landscape sheets are rotated
 * onto it, so a single job can mix orientations on every platform.
 */
export async function printSides(sides: Side[], options: PrintOptions, pages: PrintPages): Promise<void> {
  const { layout, paper } = options;
  document.getElementById("mdz-print")?.remove();
  document.getElementById("mdz-page-style")?.remove();
  const { width, height } = PAPERS[paper];
  const printed = sides.map((side) => {
    const geo = sheetGeometry(layout, paper, side.orientation ?? "portrait");
    const sheet = buildSheet(side, geo, pages, options);
    const page = el("div", { className: "mdz-print-page" }, sheet);
    Object.assign(page.style, { width: `${width}mm`, height: `${height}mm` });
    if (geo.orientation === "landscape") {
      // Rotate clockwise around the top-left corner, then move back onto the page.
      Object.assign(sheet.style, { transformOrigin: "0 0", transform: `translateX(${width}mm) rotate(90deg)` });
    }
    return page;
  });
  const root = el("div", { id: "mdz-print" }, ...printed);
  const pageStyle = el("style", { id: "mdz-page-style", textContent: `@page { size: ${width}mm ${height}mm; margin: 0; }` });
  document.head.append(pageStyle);
  document.body.append(root);
  document.body.classList.add("mdz-printing");
  await waitForImages(root);
  window.addEventListener("afterprint", () => document.body.classList.remove("mdz-printing"), { once: true });
  // Automated tests set this hook to capture the prepared sheets without opening the system print dialog.
  const hook = (window as { mdzPrintHook?: () => Promise<void> }).mdzPrintHook;
  await (hook ? hook() : backend.printPage());
}

export async function waitForImages(root: HTMLElement, timeout = 5000): Promise<void> {
  const pending = [...root.querySelectorAll("img")].filter((img) => !img.complete);
  await Promise.race([
    Promise.all(
      pending.map(
        (img) =>
          new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          }),
      ),
    ),
    new Promise((resolve) => setTimeout(resolve, timeout)),
  ]);
}
