// Wide objects in the continuous Markdown view.
//
// Text stays in a readable column. Tables, code blocks, display math, diagrams
// and images that need more room than the column get just as much as they need
// so they do not have to scroll, up to the object width the user set with the
// ruler, and are centred in the view. Objects that fit are left alone.

/** Widths in CSS px at 100 % zoom (they scale with the zoom like the text). */
export interface Widths {
  /** Width of the text column (content, without padding). */
  text: number;
  /** Widest an object may grow before it wraps or scales; never less than `text`. */
  objects: number;
}

/** The text column of earlier versions: 980 px including 48 px padding on each side. */
export const DEFAULT_TEXT_WIDTH = 884;
export const MIN_TEXT_WIDTH = 360;
/** Gap kept between a widened object and the edges of the view, px. */
export const VIEW_GAP = 16;

/**
 * Rigid objects can be laid out narrower by wrapping (tables) or not at all
 * (code, math) and scroll when they do not fit; scalable ones shrink.
 */
type Kind = "rigid" | "scalable";

interface WideObject {
  element: HTMLElement;
  kind: Kind;
}

function outsideTable(element: Element): boolean {
  return !element.parentElement?.closest("table");
}

/** Objects of the article that may be widened (not ones nested in a table). */
export function wideCandidates(article: HTMLElement): WideObject[] {
  const rigid = [...article.querySelectorAll<HTMLElement>("table, pre, .katex-display")].filter(
    (e) => outsideTable(e) && !e.parentElement?.closest("pre") && !e.closest(".mdz-diagram"),
  );
  const diagrams = [...article.querySelectorAll<HTMLElement>("figure.mdz-diagram")].filter(outsideTable);
  // Images standing alone in a paragraph (a picture, not an icon inside text).
  const images = [...article.querySelectorAll<HTMLImageElement>("p img")].filter(
    (img) => outsideTable(img) && img.closest("p")!.textContent!.trim() === "" && img.closest("p")!.querySelectorAll("img").length === 1,
  );
  return [...rigid.map((element) => ({ element, kind: "rigid" as Kind })), ...[...diagrams, ...images].map((element) => ({ element, kind: "scalable" as Kind }))];
}

/** Natural width of a diagram or image, in CSS px. */
function naturalWidth(element: HTMLElement): number {
  if (element instanceof HTMLImageElement) return element.naturalWidth;
  const svg = element.querySelector("svg");
  if (!svg) return 0;
  const max = parseFloat(svg.style.maxWidth);
  if (max) return max;
  const width = svg.width.baseVal;
  if (width.unitType !== SVGLength.SVG_LENGTHTYPE_PERCENTAGE && width.value) return width.value;
  return svg.viewBox.baseVal?.width ?? 0;
}

function reset(element: HTMLElement): void {
  element.classList.remove("mdz-wide");
  element.style.width = "";
  element.style.maxWidth = "";
  element.style.marginLeft = "";
  element.style.boxSizing = "";
}

/**
 * Lays out the wide objects of `article` shown in `view` at `zoom`. Reads and
 * writes are batched (a handful of layouts for the whole document), because
 * this runs on every resize of the view.
 */
export function fitWideObjects(article: HTMLElement, view: HTMLElement, zoom: number, widths: Widths | null): void {
  const objects = wideCandidates(article);
  objects.forEach((o) => reset(o.element));
  if (!widths || !objects.length) return;

  // Lengths inside the article are scaled by its zoom; measure in its units.
  const room = Math.max(0, (view.clientWidth - 2 * VIEW_GAP) / zoom);
  const limit = Math.max(widths.objects, widths.text);

  const measure = (width: string) => {
    for (const { element, kind } of objects) {
      // Widths include padding (code blocks), like the final width set below.
      element.style.boxSizing = "border-box";
      if (kind === "rigid" || width === "100%") element.style.width = width;
    }
    return objects.map(({ element }) => element.getBoundingClientRect().width / zoom);
  };
  const available = measure("100%");
  objects.forEach(({ element }) => (element.style.maxWidth = "none"));
  const least = measure("min-content");
  const most = measure("max-content");
  objects.forEach((o) => reset(o.element));

  const targets = objects.map(({ element, kind }, i) => {
    const width =
      kind === "rigid"
        ? Math.min(room, Math.max(least[i], Math.min(most[i], limit))) // as narrow as possible without scrolling
        : Math.min(room, naturalWidth(element), limit);
    return width > available[i] + 1 ? width : 0;
  });
  objects.forEach(({ element }, i) => {
    if (!targets[i]) return;
    element.classList.add("mdz-wide");
    element.style.maxWidth = "none";
    element.style.width = `${targets[i]}px`;
  });
  // Centre in the view: shift each widened object from where it starts now. A margin, not a
  // transform: the view's scroll width follows the layout box and must not grow.
  const box = view.getBoundingClientRect();
  const centre = box.left + view.clientWidth / 2;
  const lefts = objects.map(({ element }, i) => (targets[i] ? element.getBoundingClientRect().left : 0));
  objects.forEach(({ element }, i) => {
    if (!targets[i]) return;
    const shift = (centre - (targets[i] * zoom) / 2 - lefts[i]) / zoom;
    element.style.marginLeft = `${shift}px`;
  });
}

/**
 * Printed pages cannot scroll: tables, code blocks and math wider than the
 * text width are scaled down to fit instead of being cut off at the right edge.
 */
export function shrinkWideObjects(article: HTMLElement): void {
  const objects = wideCandidates(article).filter((o) => o.kind === "rigid");
  const available = objects.map((o) => o.element.clientWidth);
  const needed = objects.map((o) => o.element.scrollWidth);
  objects.forEach(({ element }, i) => {
    if (needed[i] <= available[i] + 1) return;
    // Keep the measured layout (a table must not grow to its unwrapped width) and scale it.
    // (+2 px for collapsed table borders.)
    Object.assign(element.style, { boxSizing: "border-box", width: `${needed[i] + 2}px`, maxWidth: "none", overflow: "visible", zoom: String(available[i] / (needed[i] + 2)) });
  });
}
