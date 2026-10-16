// Excel plugin: every visible sheet becomes a heading and a table that looks like the
// sheet in Excel (fonts, fills, borders, number formats, merged cells, column widths),
// shown by the app's Markdown view; its CSS gives the table class "mdz-sheet" the grid.

import type { PluginApi, PluginInstance } from "../../src/plugins/api";
import { formatNumber, formatText } from "./numfmt";
import { readWorkbook, type Border, type Cell, type Font, type Sheet, type Style, type Workbook } from "./workbook";

export { PLUGIN_API as api } from "../../src/plugins/api";

const ROW_LIMIT = 20000;
const COL_LIMIT = 200;
/** Cells per sheet; larger sheets show fewer rows. */
const CELL_LIMIT = 300000;

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A, B, …, Z, AA, AB, … */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** A workbook font with fallbacks: Office's Aptos and Calibri are often missing outside Office. */
function fontFamily(name: string): string {
  return `'${name.replace(/['"\\;]/g, "")}',Aptos,Calibri,Carlito,'Segoe UI',sans-serif`;
}

let measure: CanvasRenderingContext2D | null | undefined;

/** Width of one line of text in px (canvas; an estimate where there is none, e.g. in tests). */
function textWidth(text: string, font: Font): number {
  const size = font.size ?? 11;
  if (measure === undefined) {
    measure = null;
    if (typeof document !== "undefined" && !navigator.userAgent.includes("jsdom")) measure = document.createElement("canvas").getContext("2d");
  }
  if (!measure) return text.length * size * 0.75;
  measure.font = `${font.italic ? "italic " : ""}${font.bold ? "bold " : ""}${size}pt ${fontFamily(font.name ?? "Calibri")}`;
  return measure.measureText(text).width;
}

/** CSS declarations of a font, leaving out what equals the sheet's default font. */
function fontCss(font: Font | undefined, base: Font): string[] {
  if (!font) return [];
  const css: string[] = [];
  if (font.name && font.name !== base.name) css.push(`font-family:${fontFamily(font.name)}`);
  if (font.size && font.size !== base.size) css.push(`font-size:${font.size}pt`);
  if (font.bold) css.push("font-weight:bold");
  if (font.italic) css.push("font-style:italic");
  const deco = [font.underline && "underline", font.strike && "line-through"].filter(Boolean);
  if (deco.length) css.push(`text-decoration:${deco.join(" ")}`);
  if (font.color) css.push(`color:${font.color}`);
  return css;
}

interface Shown {
  text: string;
  /** Rich text as HTML (runs with their fonts). */
  html?: string;
  color?: string;
  /** Accounting formats: the text before this index stays left, the rest goes right. */
  fill?: number;
  align: "left" | "right" | "center";
}

function shownValue(cell: Cell, style: Style, book: Workbook): Shown | undefined {
  const v = cell.value;
  if (v === undefined || v === "") return undefined;
  if (cell.error) return { text: String(v), align: "center" };
  if (typeof v === "boolean") return { text: v ? "TRUE" : "FALSE", align: "center" };
  if (typeof v === "number") {
    const f = formatNumber(v, style.format, book.date1904);
    return { text: f.text, color: f.color, fill: f.fill, align: "right" };
  }
  const text = formatText(v, style.format);
  const html =
    cell.runs && text === v
      ? cell.runs
          .map((r) => {
            const css = fontCss(r.font, { ...book.font, ...style.font });
            const t = escape(r.text);
            return css.length ? `<span style="${css.join(";")}">${t}</span>` : t;
          })
          .join("")
      : undefined;
  return { text, html, align: "left" };
}

const ALIGN: Record<string, string> = { left: "left", right: "right", center: "center", centerContinuous: "center", justify: "justify", distributed: "justify", fill: "left" };
const VALIGN: Record<string, string> = { top: "top", center: "middle", justify: "middle", distributed: "middle", bottom: "bottom" };

/** Borders of every cell, with each one also set on the neighbour sharing the edge (as Excel shows it). */
function cellBorders(sheet: Sheet, book: Workbook, anchorOf: (r: number, c: number) => [number, number]) {
  const borders = new Map<string, { left?: Border; right?: Border; top?: Border; bottom?: Border }>();
  const at = (r: number, c: number) => {
    const [ar, ac] = anchorOf(r, c);
    const key = `${ar}:${ac}`;
    let b = borders.get(key);
    if (!b) borders.set(key, (b = {}));
    return b;
  };
  for (const [r, cells] of sheet.rows) {
    for (const [c, cell] of cells) {
      const st = book.styles[cell.style];
      if (!st) continue;
      const own = at(r, c);
      if (st.left) {
        own.left ??= st.left;
        if (c > 0) at(r, c - 1).right ??= st.left;
      }
      if (st.right) {
        own.right ??= st.right;
        at(r, c + 1).left ??= st.right;
      }
      if (st.top) {
        own.top ??= st.top;
        if (r > 0) at(r - 1, c).bottom ??= st.top;
      }
      if (st.bottom) {
        own.bottom ??= st.bottom;
        at(r + 1, c).top ??= st.bottom;
      }
    }
  }
  return borders;
}

export function sheetHtml(sheet: Sheet, book: Workbook): { html: string; rows: number; cols: number; cut: boolean } {
  const cols: number[] = [];
  for (let c = 0; c <= Math.min(sheet.lastCol, COL_LIMIT - 1); c++) if (!sheet.hiddenCols.has(c)) cols.push(c);
  const rowLimit = Math.min(ROW_LIMIT, Math.max(100, Math.floor(CELL_LIMIT / Math.max(1, cols.length))));
  const rows: number[] = [];
  for (let r = 0; r <= sheet.lastRow && rows.length < rowLimit; r++) if (!sheet.hiddenRows.has(r)) rows.push(r);
  const cut = rows.length < sheet.lastRow + 1 - [...sheet.hiddenRows].filter((r) => r <= sheet.lastRow).length || sheet.lastCol >= COL_LIMIT;
  const width = (c: number) => sheet.colWidths.get(c) ?? sheet.defaultColWidth;

  // Merged ranges: the first cell spans the visible rows and columns, the others are left out.
  const covered = new Map<string, [number, number]>();
  const spans = new Map<string, { rows: number; cols: number; px: number }>();
  const shownRows = new Set(rows);
  const shownCols = new Set(cols);
  for (const m of sheet.merges) {
    let rs = 0;
    let cs = 0;
    let px = 0;
    for (let r = m.row; r < m.row + m.rows; r++) if (shownRows.has(r)) rs++;
    for (let c = m.col; c < m.col + m.cols; c++)
      if (shownCols.has(c)) {
        cs++;
        px += width(c);
      }
    spans.set(`${m.row}:${m.col}`, { rows: Math.max(rs, 1), cols: Math.max(cs, 1), px });
    for (let r = m.row; r < m.row + m.rows; r++)
      for (let c = m.col; c < m.col + m.cols; c++) if (r !== m.row || c !== m.col) covered.set(`${r}:${c}`, [m.row, m.col]);
  }
  const anchorOf = (r: number, c: number): [number, number] => covered.get(`${r}:${c}`) ?? [r, c];
  const borders = cellBorders(sheet, book, anchorOf);
  const isEmpty = (r: number, c: number) => {
    if (covered.has(`${r}:${c}`) || spans.has(`${r}:${c}`)) return false;
    const v = sheet.rows.get(r)?.get(c)?.value;
    return v === undefined || v === "";
  };

  // Text runs on over empty cells to the right, as in Excel: where it goes past the
  // used range (all text in column A, say), the empty columns it needs are added.
  const left = new Map<number, number>();
  let tableWidth = 0;
  for (const c of cols) {
    left.set(c, tableWidth);
    tableWidth += width(c);
  }
  let reach = 0;
  for (const r of rows) {
    const cells = sheet.rows.get(r);
    if (!cells) continue;
    // Only the last cell with a value in the row can run on past the last column.
    let last = -1;
    for (const [c, cell] of cells) if (left.has(c) && cell.value !== undefined && cell.value !== "" && c > last) last = c;
    const cell = cells.get(last);
    if (!cell || typeof cell.value !== "string" || cell.error || covered.has(`${r}:${last}`) || spans.has(`${r}:${last}`)) continue;
    const style = book.styles[cell.style] ?? book.styles[0];
    if (style.wrap || ((style.horizontal && ALIGN[style.horizontal]) || "left") !== "left") continue;
    const text = formatText(cell.value, style.format).replace(/\r?\n/g, " ");
    reach = Math.max(reach, left.get(last)! + textWidth(text, { ...book.font, ...style.font }) + 8 - tableWidth);
  }
  for (let c = (cols[cols.length - 1] ?? -1) + 1; reach > 0 && cols.length < COL_LIMIT; c++) {
    if (sheet.hiddenCols.has(c)) continue;
    cols.push(c);
    reach -= width(c);
  }

  const head = `<tr><th class="mdz-corner"></th>${cols.map((c) => `<th style="width:${width(c)}px;min-width:${width(c)}px">${columnName(c)}</th>`).join("")}</tr>`;
  const body: string[] = [];
  for (const r of rows) {
    const height = sheet.rowHeights.get(r);
    const tds: string[] = [];
    cols.forEach((c, i) => {
      const key = `${r}:${c}`;
      if (covered.has(key)) return;
      const cell = sheet.rows.get(r)?.get(c);
      const style = book.styles[cell?.style ?? 0] ?? book.styles[0];
      const span = spans.get(key);
      const css: string[] = [];
      if (style.fill) css.push(`background:${style.fill}`);
      const b = borders.get(key);
      if (b?.left) css.push(`border-left:${b.left}`);
      if (b?.right) css.push(`border-right:${b.right}`);
      if (b?.top) css.push(`border-top:${b.top}`);
      if (b?.bottom) css.push(`border-bottom:${b.bottom}`);
      const valign = style.vertical && VALIGN[style.vertical];
      if (valign && valign !== "bottom") css.push(`vertical-align:${valign}`);
      const attrs = `${span && span.cols > 1 ? ` colspan="${span.cols}"` : ""}${span && span.rows > 1 ? ` rowspan="${span.rows}"` : ""}`;
      const shown = cell && shownValue(cell, style, book);
      if (!shown) {
        tds.push(`<td${attrs}${css.length ? ` style="${css.join(";")}"` : ""}></td>`);
        return;
      }
      // The content keeps the column width; text runs on over empty cells to the right, as in Excel.
      const px = (span?.px ?? width(c)) - 1;
      const inner = [`width:${px}px`, ...fontCss(style.font, book.font)];
      const align = (style.horizontal && ALIGN[style.horizontal]) || shown.align;
      if (align !== "left") inner.push(`text-align:${align}`);
      if (style.indent) inner.push(`padding-${align === "right" ? "right" : "left"}:${3 + style.indent * 9}px`);
      if (shown.color) inner.push(`color:${shown.color}`);
      const next = cols[i + 1];
      const spill = !style.wrap && align === "left" && typeof cell.value === "string" && !span && next !== undefined && isEmpty(r, next);
      const cls = style.wrap ? "wrap" : spill ? "spill" : "";
      let content = shown.html ?? escape(shown.text);
      if (shown.fill !== undefined) {
        inner.push("display:flex", "justify-content:space-between");
        content = `<span>${escape(shown.text.slice(0, shown.fill))}</span><span>${escape(shown.text.slice(shown.fill))}</span>`;
      }
      tds.push(
        `<td${attrs}${css.length ? ` style="${css.join(";")}"` : ""}><div${cls ? ` class="${cls}"` : ""} style="${inner.join(";")}">${content.replace(/\r?\n/g, style.wrap ? "<br>" : " ")}</div></td>`,
      );
    });
    body.push(`<tr${height !== undefined ? ` style="height:${height}px"` : ""}><th>${r + 1}</th>${tds.join("")}</tr>`);
  }
  const font = book.font;
  const tableCss = [font.name ? `font-family:${fontFamily(font.name)}` : "", font.size ? `font-size:${font.size}pt` : ""].filter(Boolean);
  const html = `<table class="mdz-sheet${sheet.gridLines ? "" : " mdz-nogrid"}"${tableCss.length ? ` style="${tableCss.join(";")}"` : ""}><thead>${head}</thead><tbody>\n${body.join("\n")}\n</tbody></table>`;
  return { html, rows: rows.length, cols: cols.length, cut };
}

export async function xlsxToMarkdown(data: Uint8Array): Promise<string> {
  const book = readWorkbook(data);
  const parts: string[] = [];
  for (const sheet of book.sheets) {
    parts.push(`## ${sheet.name.replace(/[\\`*_#[\]<>]/g, "\\$&")}`);
    if (sheet.lastRow < 0) {
      parts.push("*The sheet is empty.*");
      continue;
    }
    const { html, rows, cols, cut } = sheetHtml(sheet, book);
    parts.push(html);
    if (cut) parts.push(`*Only the first ${rows} rows and ${cols} columns are shown.*`);
  }
  if (!book.sheets.length) parts.push("*The workbook has no sheets with cells.*");
  return parts.join("\n\n") + "\n";
}

export default function activate(api: PluginApi): PluginInstance {
  return { createView: (host) => api.createMarkdownView(host, xlsxToMarkdown) };
}
