// Excel sheets (tables of the xlsx plugin, class "mdz-excel") on paper: the print
// area or the whole sheet, without row and column headings and gridlines unless
// the sheet prints them, its title rows repeated on every page. The plugin marks
// rows (data-r) and cells (data-c, data-ce for the last column of a merged cell)
// with their place in the sheet and the table with Excel's print settings.
// On screen the sheet stays as it is.

import type { SheetArea } from "../print/imposition";

const numbers = (text: string | undefined) => (text ?? "").split(",").map(Number);

/** Whether an element is an Excel sheet; sheets are scaled to fit, never split or cut. */
export function isSheet(element: Element): boolean {
  return element.tagName === "TABLE" && element.classList.contains("mdz-excel");
}

/** "Fit to 1 page tall" of the sheet's print settings. */
export function fitsOnePageTall(element: Element): boolean {
  const fit = (element as HTMLElement).dataset.mdzPrintFit;
  return !!fit && numbers(fit)[1] === 1;
}

/** Prepares the sheets of a laid-out article for paper; returns how many there are. */
export function prepareSheetsForPaper(article: HTMLElement, mode: SheetArea): number {
  const tables = [...article.querySelectorAll<HTMLTableElement>("table.mdz-excel")];
  for (const table of tables) {
    const data = table.dataset;
    const titles = data.mdzPrintTitles ? numbers(data.mdzPrintTitles) : null;
    const isTitle = (row: number) => !!titles && row >= titles[0] && row <= titles[1];
    if (mode === "printArea" && data.mdzPrintArea) crop(table, numbers(data.mdzPrintArea), isTitle);
    if (!("mdzPrintHeadings" in data)) table.classList.add("mdz-print-noheadings");
    if (!("mdzPrintGrid" in data)) table.classList.add("mdz-nogrid");
    // Title rows go into the header, which is repeated on every page the table continues on.
    if (titles && table.tBodies[0]) {
      const head = table.tHead ?? table.createTHead();
      for (const row of [...table.tBodies[0].rows]) if (isTitle(Number(row.dataset.r))) head.append(row);
    }
  }
  return tables.length;
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
