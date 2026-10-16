// Excel sheets (tables of the xlsx plugin, class "mdz-excel"): what part of a sheet
// is shown, on paper and on screen alike, so a very long sheet can be read by its
// print area. The plugin marks rows (data-r) and cells (data-c, data-ce for the last
// column of a merged cell) with their place in the sheet, and the table with its
// name (data-mdz-key) and Excel's print settings.
//
// Which part, highest priority first: your choice for the sheet (stored on this
// computer like your page exceptions), then the print settings (Excel sheets:
// print area when set, or the whole sheet). On screen a tag above the sheet says
// that a part is shown and offers the choice; on paper headings and gridlines
// appear only when Excel prints them, title rows repeat on every page and the
// sheet is scaled to the page width (or onto one page).

import type { SheetArea } from "../print/imposition";
import type { LocalException } from "../print/orientation";

const numbers = (text: string | undefined) => (text ?? "").split(",").map(Number);

/** A, B, …, Z, AA, … */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** [first row, first column, last row, last column], 0-based, as "B3:K40". */
export function rangeText([r1, c1, r2, c2]: number[]): string {
  const start = `${columnName(c1)}${r1 + 1}`;
  return r1 === r2 && c1 === c2 ? start : `${start}:${columnName(c2)}${r2 + 1}`;
}

/** "B3:K40" (or "b3", "K40:B3") as [first row, first column, last row, last column]; null when it is not a range. */
export function parseRangeText(text: string): number[] | null {
  const m = /^\s*\$?([A-Z]{1,3})\$?(\d{1,7})\s*(?::\s*\$?([A-Z]{1,3})\$?(\d{1,7}))?\s*$/i.exec(text);
  if (!m) return null;
  const col = (letters: string) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const [ra, ca, rb, cb] = [Number(m[2]) - 1, col(m[1]), Number(m[4] ?? m[2]) - 1, col(m[3] ?? m[1])];
  if (ra < 0 || rb < 0) return null;
  return [Math.min(ra, rb), Math.min(ca, cb), Math.max(ra, rb), Math.max(ca, cb)];
}

/** Whether an element is an Excel sheet; sheets are scaled to fit, never split or cut. */
export function isSheet(element: Element): boolean {
  return element.tagName === "TABLE" && element.classList.contains("mdz-excel");
}

/** The sheet goes onto one page (its own "fit to 1 page tall", or your choice). */
export function fitsOnePageTall(element: Element): boolean {
  const fit = (element as HTMLElement).dataset.mdzPrintFit;
  return !!fit && numbers(fit)[1] === 1;
}

/** Your choice for one sheet. */
export interface SheetChoice {
  /** "printArea", "all" or a range like "B3:K40"; none = the print settings decide. */
  area?: string;
  fit?: "width" | "page";
}

/** What of a sheet is shown and why, for the tag above it and its menu. */
export interface SheetState {
  /** Block key of the sheet, "sheet:<name>". */
  key: string;
  name: string;
  /** Excel's print area, e.g. "A7:J11". */
  printArea?: string;
  /** All of the sheet that is shown when nothing is cut. */
  whole: string;
  /** What is shown now. */
  shown: string;
  /** Rows and columns kept, or none for the whole sheet. */
  crop?: number[];
  /** Who decided what is shown. */
  source: "yours" | "settings";
  /** The print settings' choice (Excel sheets). */
  settings: SheetArea;
  /** Your choice for this sheet. */
  choice: SheetChoice;
  /** On paper: to the page width or onto one page, and who decided. */
  fit: "width" | "page";
  fitSource: "yours" | "file" | "default";
  /** The file's page setup fits the sheet onto one page (whatever you chose). */
  fileFit: boolean;
}

/** Your choice for the sheet with block key `key`. */
export function sheetChoice(locals: LocalException[], key: string): SheetChoice {
  const item = locals.find((l) => l.anchor.key === key && (l.area || l.fit));
  return item ? { ...(item.area ? { area: item.area } : {}), ...(item.fit ? { fit: item.fit } : {}) } : {};
}

/** Decides what of a sheet table is shown. */
export function sheetState(table: HTMLTableElement, mode: SheetArea, locals: LocalException[]): SheetState {
  const data = table.dataset;
  const key = data.mdzKey ?? `sheet:${data.mdzSheet ?? ""}`;
  const rows = [...(table.tBodies[0]?.rows ?? [])].map((r) => Number(r.dataset.r)).filter((r) => !Number.isNaN(r));
  const cols = [...(table.tHead?.rows[0]?.cells ?? [])].map((c) => Number(c.dataset.c)).filter((c) => !Number.isNaN(c));
  const all = [rows[0] ?? 0, cols[0] ?? 0, rows.at(-1) ?? 0, cols.at(-1) ?? 0];
  const area = data.mdzPrintArea ? numbers(data.mdzPrintArea) : undefined;
  const choice = sheetChoice(locals, key);
  let crop: number[] | undefined;
  if (choice.area === "printArea" || (!choice.area && mode === "printArea")) crop = area;
  else if (choice.area && choice.area !== "all") crop = parseRangeText(choice.area) ?? undefined;
  // Nothing cut when the part covers all of the sheet.
  if (crop && crop[0] <= all[0] && crop[1] <= all[1] && crop[2] >= all[2] && crop[3] >= all[3]) crop = undefined;
  const fileFit = fitsOnePageTall(table) ? "page" : undefined;
  return {
    key,
    name: data.mdzSheet ?? "",
    printArea: area && rangeText(area),
    whole: rangeText(all),
    shown: crop ? rangeText(crop) : rangeText(all),
    crop,
    source: choice.area ? "yours" : "settings",
    settings: mode,
    choice,
    fit: choice.fit ?? fileFit ?? "width",
    fitSource: choice.fit ? "yours" : fileFit ? "file" : "default",
    fileFit: !!fileFit,
  };
}

/** One line about a sheet for the notes of the page view and print dialog; empty when all of it is shown. */
function sheetNote(s: SheetState): string {
  const parts: string[] = [];
  if (s.crop) parts.push(`${s.choice.area && s.choice.area !== "printArea" ? "range" : "print area"} ${s.shown} of ${s.whole}${s.source === "yours" ? " (your choice)" : ""}`);
  if (s.fit === "page") parts.push(`on one page${s.fitSource === "yours" ? " (your choice)" : " (page setup in the file)"}`);
  return parts.length ? `Excel sheet “${s.name}”: ${parts.join(", ")}.` : "";
}

/** The text of the tag of a sheet: what part is shown. */
export function sheetTagText(s: SheetState): string {
  return s.crop
    ? `${s.choice.area && s.choice.area !== "printArea" ? "Range" : "Print area"} ${s.shown} of ${s.whole} ▾`
    : `Whole sheet ${s.whole}${s.printArea ? ` · print area ${s.printArea}` : ""} ▾`;
}

/** The tooltip of the tag of a sheet. */
export function sheetTagTitle(s: SheetState): string {
  return `${s.crop ? "Only a part of the sheet is shown, as it is printed." : "All of the sheet is shown."} On paper: ${s.fit === "page" ? "on one page" : "fitted to the page width"}. Click to choose.`;
}

/** Keeps the title rows of a sheet, which repeat at the top of its pages. */
function titleRows(table: HTMLTableElement): (row: number) => boolean {
  const titles = table.dataset.mdzPrintTitles ? numbers(table.dataset.mdzPrintTitles) : null;
  return (row) => !!titles && row >= titles[0] && row <= titles[1];
}

/** Prepares the sheets of a laid-out article for paper: how many there are, and notes about the parts shown. */
export function prepareSheetsForPaper(article: HTMLElement, mode: SheetArea, locals: LocalException[] = []): { count: number; notes: string[]; states: SheetState[] } {
  const tables = [...article.querySelectorAll<HTMLTableElement>("table.mdz-excel")];
  const notes: string[] = [];
  const states: SheetState[] = [];
  for (const table of tables) {
    const state = sheetState(table, mode, locals);
    states.push(state);
    const isTitle = titleRows(table);
    if (state.crop) crop(table, state.crop, isTitle);
    table.dataset.mdzPrintFit = state.fit === "page" ? "1,1" : "1,0";
    const data = table.dataset;
    if (!("mdzPrintHeadings" in data)) table.classList.add("mdz-print-noheadings");
    if (!("mdzPrintGrid" in data)) table.classList.add("mdz-nogrid");
    // Title rows go into the header, which is repeated on every page the table continues on.
    if (table.tBodies[0]) {
      const head = table.tHead ?? table.createTHead();
      for (const row of [...table.tBodies[0].rows]) if (isTitle(Number(row.dataset.r))) head.append(row);
    }
    const note = sheetNote(state);
    if (note) notes.push(note);
  }
  return { count: tables.length, notes, states };
}

/**
 * Shows the same part of each sheet on screen as on paper (headings stay, so the
 * row and column numbers tell where it is) with a tag above it: that a part is
 * shown, and a menu to choose. Returns the sheets, by their index in the article.
 */
export function prepareSheetsForScreen(article: HTMLElement, mode: SheetArea, locals: LocalException[] = []): SheetState[] {
  return [...article.querySelectorAll<HTMLTableElement>("table.mdz-excel")].map((table, index) => {
    const state = sheetState(table, mode, locals);
    if (state.crop) crop(table, state.crop, titleRows(table));
    // A tag above every sheet: what part is shown, and the menu to choose another.
    const tag = document.createElement("button");
    tag.type = "button";
    tag.className = "mdz-area-tag";
    tag.dataset.mdzSheetIndex = String(index);
    tag.textContent = sheetTagText(state);
    tag.title = sheetTagTitle(state);
    const caption = table.createCaption();
    caption.className = "mdz-area";
    caption.append(tag);
    return state;
  });
}

/** Keeps the rows and columns of `area` (row, column, last row, last column) and the title rows. */
function crop(table: HTMLTableElement, [firstRow, firstCol, lastRow, lastCol]: number[], keepRow: (row: number) => boolean): void {
  // Column widths and visible columns come from the column headings (A, B, …).
  const widths = new Map<number, number>();
  for (const th of table.tHead?.rows[0]?.cells ?? []) {
    if (th.dataset.c !== undefined) widths.set(Number(th.dataset.c), parseFloat(th.style.width) || 0);
  }
  for (const row of [...table.rows]) {
    const r = row.dataset.r;
    if (r !== undefined && (Number(r) < firstRow || Number(r) > lastRow) && !keepRow(Number(r))) {
      row.remove();
      continue;
    }
    for (const cell of [...row.cells]) {
      if (cell.dataset.c === undefined) continue;
      const start = Number(cell.dataset.c);
      const end = cell.dataset.ce !== undefined ? Number(cell.dataset.ce) : start;
      if (end < firstCol || start > lastCol) {
        cell.remove();
        continue;
      }
      // Text stops at the edge of the print area, as in Excel.
      if (end >= lastCol) cell.querySelector(":scope > div.spill")?.classList.remove("spill");
      if (start >= firstCol && end <= lastCol) continue;
      // A merged cell across the edge of the area keeps only its columns inside.
      const kept = [...widths.keys()].filter((c) => c >= Math.max(start, firstCol) && c <= Math.min(end, lastCol));
      cell.colSpan = Math.max(1, kept.length);
      const content = cell.querySelector<HTMLElement>(":scope > div");
      if (content) content.style.width = `${kept.reduce((sum, c) => sum + (widths.get(c) ?? 0), 0) - 1}px`;
    }
  }
}
