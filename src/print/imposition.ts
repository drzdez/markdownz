// Print imposition: which document pages go on which side of which sheet.
// Pure functions, unit tested; the DOM side lives in printJob.ts.

export type Layout = "1" | "2" | "4" | "booklet";
export type Duplex = "none" | "long" | "short" | "manual";
export type Paper = "a4" | "letter";
export type Orientation = "portrait" | "landscape";
export type OrientationOption = "auto" | Orientation;
export type AlignH = "left" | "center" | "right";
export type AlignV = "top" | "center" | "bottom";
/** fit = as large as the slot allows; percent of the real size; target width or height in mm. */
export type ScaleMode = "fit" | "percent" | "width" | "height";
/** Tables (and code, math) wider than the text: on landscape pages, scaled to the text width, or cut off. */
export type WideTables = "landscape" | "shrink" | "none";

/** How a reflowing document (Markdown) is laid out on its pages. */
export interface PageLayoutOptions {
  wideTables: WideTables;
  /** Wide content is never scaled below this text size; what still does not fit continues below. */
  minFontPt: number;
  /** Repeat the header rows of a table on every page it continues on. */
  repeatHeaders: boolean;
}

export interface PrintOptions {
  layout: Layout;
  duplex: Duplex;
  paper: Paper;
  /** Sheet orientation; "auto" follows the orientation of the pages. */
  orientation: OrientationOption;
  /** Page range like "1-3, 5, 8-"; empty = all pages. */
  range: string;
  /** Manual duplex: print the back sides in reverse order (depends on how the printer stacks paper). */
  reverseBacks: boolean;
  scaleMode: ScaleMode;
  /** Percent or millimetres, depending on scaleMode (ignored for "fit"). */
  scaleValue: number;
  alignH: AlignH;
  alignV: AlignV;
  /** Margin of the physical sheet in mm. */
  margin: number;
  /** Draw a thin frame around every placed page. */
  border: boolean;
  /** Draw a frame along the sheet margins (the printable area). */
  marginFrame: boolean;
  /**
   * Margins also along the fold between pages sharing a sheet: an A4 sheet with
   * two pages behaves like two A5 sheets, each with its own margins.
   */
  gutterMargin: boolean;
  wideTables: WideTables;
  minFontPt: number;
  repeatHeaders: boolean;
}

/** Defaults (also what Reset restores): automatic where possible, two-sided, no margins, no frames. */
export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  layout: "1",
  duplex: "long",
  paper: "a4",
  orientation: "auto",
  range: "",
  reverseBacks: false,
  scaleMode: "fit",
  scaleValue: 100,
  alignH: "center",
  alignV: "center",
  margin: 0,
  border: false,
  marginFrame: false,
  gutterMargin: true,
  wideTables: "landscape",
  minFontPt: 7,
  repeatHeaders: true,
};

/**
 * Page format a document is laid out for, and how wide content is handled.
 * Markdown printed one page per landscape sheet is laid out for the landscape
 * width; then every page is landscape already and wide tables can only shrink.
 */
export function pageSetup(options: PrintOptions): { format: { width: number; height: number }; layout: PageLayoutOptions; key: string } {
  const paper = PAPERS[options.paper];
  const wide = options.layout === "1" && options.orientation === "landscape";
  const format = wide ? { width: paper.height, height: paper.width } : paper;
  const wideTables: WideTables = wide && options.wideTables === "landscape" ? "shrink" : options.wideTables;
  const { minFontPt, repeatHeaders } = options;
  return { format, layout: { wideTables, minFontPt, repeatHeaders }, key: JSON.stringify([options.paper, wide, wideTables, minFontPt, repeatHeaders]) };
}

/** Gap between pages sharing a sheet: twice the margin when the fold gets margins too. */
export function slotGap(margin: number, gutterMargin: boolean): number {
  return gutterMargin ? 2 * margin : 0;
}

export interface Placement {
  scale: number;
  /** Offset and size inside the slot, in mm. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Scale factor for a page of `page` size (mm) in a slot. */
export function pageScale(slot: { width: number; height: number }, page: { width: number; height: number }, mode: ScaleMode, value: number): number {
  switch (mode) {
    case "fit":
      return Math.min(slot.width / page.width, slot.height / page.height);
    case "percent":
      return value / 100;
    case "width":
      return value / page.width;
    case "height":
      return value / page.height;
  }
}

/**
 * Places a page of `page` size (mm) into a slot, scaled according to the mode,
 * then aligned. A page larger than the slot gets a negative offset and is
 * clipped by the slot.
 */
export function placePage(
  slot: { width: number; height: number },
  page: { width: number; height: number },
  scaleMode: ScaleMode,
  scaleValue: number,
  alignH: AlignH,
  alignV: AlignV,
): Placement {
  const scale = pageScale(slot, page, scaleMode, scaleValue);
  const width = page.width * scale;
  const height = page.height * scale;
  const free = { x: slot.width - width, y: slot.height - height };
  const factor = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
  return { scale, width, height, x: free.x * factor[alignH], y: free.y * factor[alignV] };
}

/** Size of one slot (mm) on a sheet with the given margin. */
export function slotSize(geo: SheetGeometry, margin: number, gutterMargin: boolean): { width: number; height: number } {
  const gap = slotGap(margin, gutterMargin);
  return {
    width: (geo.width - 2 * margin - (geo.cols - 1) * gap) / geo.cols,
    height: (geo.height - 2 * margin - (geo.rows - 1) * gap) / geo.rows,
  };
}

/** Paper sizes in millimetres, portrait. */
export const PAPERS: Record<Paper, { width: number; height: number }> = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
};

/** One printed side of a sheet; slots hold zero-based page indexes, null = blank. */
export interface Side {
  slots: (number | null)[];
  /** Set by the print dialog after orientSides(). */
  orientation?: Orientation;
}

export interface SheetGeometry {
  orientation: Orientation;
  /** Sheet size in mm as it is read (wider than tall for landscape sheets). */
  width: number;
  height: number;
  cols: number;
  rows: number;
}

/** Parses "1-3, 5, 8-" into zero-based page indexes; null when the syntax is invalid. */
export function parseRange(range: string, count: number): number[] | null {
  const text = range.trim();
  if (!text) return [...Array(count).keys()];
  const pages: number[] = [];
  for (const part of text.split(/[,;]\s*|\s+/).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*(-?)\s*(\d*)$/);
    if (!m || (!m[1] && !m[3])) return null;
    const from = m[1] ? Number(m[1]) : 1;
    const to = m[2] ? (m[3] ? Number(m[3]) : count) : from;
    if (from < 1 || to < from) return null;
    for (let p = from; p <= Math.min(to, count); p++) pages.push(p - 1);
  }
  return pages;
}

export function sheetGeometry(layout: Layout, paper: Paper, orientation: Orientation): SheetGeometry {
  const p = PAPERS[paper];
  const [width, height] = orientation === "portrait" ? [p.width, p.height] : [p.height, p.width];
  const landscape = orientation === "landscape";
  switch (layout) {
    case "1":
      return { orientation, width, height, cols: 1, rows: 1 };
    case "4":
      return { orientation, width, height, cols: 2, rows: 2 };
    case "2":
    case "booklet":
      // Two pages side by side on a landscape sheet, or one above the other on a portrait one.
      return { orientation, width, height, cols: landscape ? 2 : 1, rows: landscape ? 1 : 2 };
  }
}

/** Sheet orientation that gives the pages the most room. */
export function preferredOrientation(layout: Layout, landscapePages: boolean): Orientation {
  switch (layout) {
    case "booklet":
      return "landscape";
    case "2":
      return landscapePages ? "portrait" : "landscape";
    default:
      return landscapePages ? "landscape" : "portrait";
  }
}

/**
 * Orientation of every side: "auto" follows the pages on each side (also when
 * printing two-sided), a fixed choice applies to all. Booklets are always
 * landscape.
 */
export function orientSides(
  sides: Side[],
  layout: Layout,
  option: OrientationOption,
  isLandscape: (page: number) => boolean,
): Orientation[] {
  if (layout === "booklet") return sides.map(() => "landscape");
  if (option !== "auto") return sides.map(() => option);
  return sides.map((side) => {
    const pages = side.slots.filter((p): p is number => p !== null);
    return preferredOrientation(layout, pages.filter(isLandscape).length * 2 > pages.length);
  });
}

/** Orientation of most sides; decides the flip edge of a two-sided job. */
export function dominantOrientation(sides: Side[]): Orientation {
  const landscape = sides.filter((s) => s.orientation === "landscape").length;
  return landscape * 2 > sides.length ? "landscape" : "portrait";
}

/** Distributes `pages` (in reading order) onto sheet sides. */
export function impose(pages: number[], layout: Layout): Side[] {
  if (layout === "booklet") {
    // Pad to a multiple of 4; sheet s carries pages (n-1-2s, 2s) on the front and (2s+1, n-2-2s) on the back.
    const n = Math.ceil(pages.length / 4) * 4;
    const at = (i: number) => (i < pages.length ? pages[i] : null);
    const sides: Side[] = [];
    for (let s = 0; s < n / 4; s++) {
      sides.push({ slots: [at(n - 1 - 2 * s), at(2 * s)] });
      sides.push({ slots: [at(2 * s + 1), at(n - 2 - 2 * s)] });
    }
    return sides;
  }
  const perSide = Number(layout);
  const sides: Side[] = [];
  for (let i = 0; i < pages.length; i += perSide) {
    const slots: (number | null)[] = pages.slice(i, i + perSide);
    while (slots.length < perSide) slots.push(null);
    sides.push({ slots });
  }
  return sides;
}

/**
 * Print jobs to send. Manual duplex prints all front sides first and the back
 * sides in a second pass after the user turns the stack over.
 */
export function passes(sides: Side[], duplex: Duplex, reverseBacks: boolean): Side[][] {
  if (duplex !== "manual") return [sides];
  const blank: Side = { slots: sides[0]?.slots.map(() => null) ?? [null], orientation: sides[sides.length - 1]?.orientation };
  const padded = sides.length % 2 ? [...sides, blank] : sides;
  const fronts = padded.filter((_, i) => i % 2 === 0);
  const backs = padded.filter((_, i) => i % 2 === 1);
  return [fronts, reverseBacks ? backs.reverse() : backs];
}

/** Which edge to flip on in the system dialog: landscape sheets turn over the short edge. */
export function flipEdge(orientation: Orientation): "long" | "short" {
  return orientation === "landscape" ? "short" : "long";
}

export function sheetCount(sides: number, duplex: Duplex): number {
  return duplex === "none" ? sides : Math.ceil(sides / 2);
}
