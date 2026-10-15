// Reads an XLSX workbook (a zip of XML parts) with what Excel shows: values, cell
// styles (fonts, fills, borders, alignment, number formats), theme colours, merged
// cells, column widths, row heights and hidden rows and columns.

import { strFromU8, unzipSync } from "fflate";
import { builtInFormat } from "./numfmt";

export interface Font {
  name?: string;
  /** Points. */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** CSS colour; none = automatic (the sheet's text colour). */
  color?: string;
}

/** CSS border, e.g. "1px solid #000000". */
export type Border = string;

export interface Style {
  format: string;
  font: Font;
  fill?: string;
  left?: Border;
  right?: Border;
  top?: Border;
  bottom?: Border;
  horizontal?: string;
  vertical?: string;
  wrap?: boolean;
  indent?: number;
}

export interface Run {
  text: string;
  font?: Font;
}

export type CellValue = string | number | boolean;

export interface Cell {
  value?: CellValue;
  /** "e" for errors (#DIV/0!), shown as text. */
  error?: boolean;
  /** Text with differently formatted parts. */
  runs?: Run[];
  style: number;
}

export interface Merge {
  row: number;
  col: number;
  rows: number;
  cols: number;
}

export interface Sheet {
  name: string;
  /** Rows by index (0-based), cells by column index. */
  rows: Map<number, Map<number, Cell>>;
  /** Used range: last row and column with a value or a visible style. */
  lastRow: number;
  lastCol: number;
  /** px */
  colWidths: Map<number, number>;
  defaultColWidth: number;
  /** px */
  rowHeights: Map<number, number>;
  defaultRowHeight: number;
  hiddenRows: Set<number>;
  hiddenCols: Set<number>;
  merges: Merge[];
  gridLines: boolean;
}

export interface Workbook {
  sheets: Sheet[];
  styles: Style[];
  date1904: boolean;
  /** The workbook's default font (Normal style). */
  font: Font;
}

const xml = (text: string) => new DOMParser().parseFromString(text, "application/xml");

/** Child elements with a local name (namespace prefixes vary between producers). */
function kids(el: Element | Document | null | undefined, name: string): Element[] {
  if (!el) return [];
  const parent = el instanceof Document ? el.documentElement : el;
  return parent ? [...parent.children].filter((c) => c.localName === name) : [];
}

const kid = (el: Element | Document | null | undefined, name: string) => kids(el, name)[0];

function all(el: Element | Document, name: string): Element[] {
  return [...el.getElementsByTagNameNS("*", name)];
}

const num = (s: string | null | undefined) => (s === null || s === undefined || s === "" ? undefined : Number(s));
const flag = (el: Element | undefined, attr = "val") => !!el && !/^(0|false)$/i.test(el.getAttribute(attr) ?? "1");

/** "B12" → [11, 1] (row, column; 0-based). */
export function parseRef(ref: string): [number, number] {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(ref.trim());
  if (!m) return [-1, -1];
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64;
  return [parseInt(m[2], 10) - 1, col - 1];
}

// ------------------------------------------------------------------ colours

/** Excel's indexed colours (legacy palette). */
const INDEXED = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

/** Theme colours in the order Excel's theme indexes use (light 1 and dark 1 swapped against the file). */
function themeColors(doc: Document | null): string[] {
  const fallback = ["FFFFFF", "000000", "E8E8E8", "0E2841", "156082", "E97132", "196B24", "0F9ED5", "A02B93", "4EA72E", "467886", "96607D"];
  if (!doc) return fallback;
  const scheme = all(doc, "clrScheme")[0];
  if (!scheme) return fallback;
  const color = (name: string, i: number) => {
    const el = kid(scheme, name);
    const c = el && (kid(el, "srgbClr")?.getAttribute("val") ?? kid(el, "sysClr")?.getAttribute("lastClr"));
    return c ?? fallback[i];
  };
  const names = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  return names.map(color);
}

function applyTint(hex: string, tint: number): string {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let rgb: number[];
  if (s === 0) rgb = [l, l, l];
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    rgb = [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  }
  return rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
}

function colorOf(el: Element | undefined, theme: string[]): string | undefined {
  if (!el || /^(1|true)$/i.test(el.getAttribute("auto") ?? "")) return undefined;
  let hex: string | undefined;
  const rgb = el.getAttribute("rgb");
  const themeIndex = num(el.getAttribute("theme"));
  const indexed = num(el.getAttribute("indexed"));
  if (rgb) hex = rgb.length === 8 ? rgb.slice(2) : rgb;
  else if (themeIndex !== undefined) hex = theme[themeIndex];
  else if (indexed !== undefined) hex = INDEXED[indexed]; // 64 and above: system colours (automatic)
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return undefined;
  const tint = num(el.getAttribute("tint"));
  return `#${(tint ? applyTint(hex, tint) : hex).toLowerCase()}`;
}

// ------------------------------------------------------------------ styles

function readFont(el: Element | undefined, theme: string[]): Font {
  if (!el) return {};
  const font: Font = {};
  const name = kid(el, "name")?.getAttribute("val") ?? kid(el, "rFont")?.getAttribute("val");
  if (name) font.name = name;
  const size = num(kid(el, "sz")?.getAttribute("val"));
  if (size) font.size = size;
  if (flag(kid(el, "b"))) font.bold = true;
  if (flag(kid(el, "i"))) font.italic = true;
  const u = kid(el, "u");
  if (u && u.getAttribute("val") !== "none") font.underline = true;
  if (flag(kid(el, "strike"))) font.strike = true;
  const color = colorOf(kid(el, "color"), theme);
  if (color) font.color = color;
  return font;
}

const BORDER_STYLES: Record<string, string> = {
  thin: "1px solid",
  hair: "1px solid",
  medium: "2px solid",
  thick: "3px solid",
  double: "3px double",
  dashed: "1px dashed",
  dotted: "1px dotted",
  dashDot: "1px dashed",
  dashDotDot: "1px dotted",
  mediumDashed: "2px dashed",
  mediumDashDot: "2px dashed",
  mediumDashDotDot: "2px dotted",
  slantDashDot: "2px dashed",
};

function readBorderSide(el: Element | undefined, theme: string[]): Border | undefined {
  const style = el?.getAttribute("style");
  if (!el || !style || !BORDER_STYLES[style]) return undefined;
  return `${BORDER_STYLES[style]} ${colorOf(kid(el, "color"), theme) ?? "#000000"}`;
}

function readFill(el: Element | undefined, theme: string[]): string | undefined {
  if (!el) return undefined;
  const pattern = kid(el, "patternFill");
  if (pattern) {
    const type = pattern.getAttribute("patternType");
    if (!type || type === "none") return undefined;
    // Patterns other than solid: their foreground colour approximates them.
    return colorOf(kid(pattern, "fgColor"), theme) ?? (type === "solid" ? undefined : colorOf(kid(pattern, "bgColor"), theme));
  }
  const gradient = kid(el, "gradientFill");
  return gradient ? colorOf(kid(kid(gradient, "stop"), "color"), theme) : undefined;
}

function readStyles(doc: Document | null, theme: string[]): { styles: Style[]; font: Font } {
  if (!doc) return { styles: [{ format: "General", font: {} }], font: {} };
  const formats = new Map<number, string>();
  for (const f of all(doc, "numFmt")) formats.set(Number(f.getAttribute("numFmtId")), f.getAttribute("formatCode") ?? "General");
  const fonts = kids(kid(doc, "fonts"), "font").map((f) => readFont(f, theme));
  const fills = kids(kid(doc, "fills"), "fill").map((f) => readFill(f, theme));
  const borders = kids(kid(doc, "borders"), "border").map((b) => ({
    left: readBorderSide(kid(b, "left") ?? kid(b, "start"), theme),
    right: readBorderSide(kid(b, "right") ?? kid(b, "end"), theme),
    top: readBorderSide(kid(b, "top"), theme),
    bottom: readBorderSide(kid(b, "bottom"), theme),
  }));
  const styles = kids(kid(doc, "cellXfs"), "xf").map((xf): Style => {
    const fmtId = Number(xf.getAttribute("numFmtId") ?? 0);
    const align = kid(xf, "alignment");
    const style: Style = {
      format: formats.get(fmtId) ?? builtInFormat(fmtId),
      font: fonts[Number(xf.getAttribute("fontId") ?? 0)] ?? {},
      fill: fills[Number(xf.getAttribute("fillId") ?? 0)],
      ...borders[Number(xf.getAttribute("borderId") ?? 0)],
    };
    if (align) {
      const h = align.getAttribute("horizontal");
      const v = align.getAttribute("vertical");
      if (h) style.horizontal = h;
      if (v) style.vertical = v;
      if (flag(align, "wrapText") && align.hasAttribute("wrapText")) style.wrap = true;
      const indent = num(align.getAttribute("indent"));
      if (indent) style.indent = indent;
    }
    return style;
  });
  return { styles: styles.length ? styles : [{ format: "General", font: {} }], font: fonts[0] ?? {} };
}

// ------------------------------------------------------------------ text

/** Text of an <si> or <is>: plain <t>, or runs <r> with their fonts. */
function readText(el: Element, theme: string[]): { text: string; runs?: Run[] } {
  const runs = kids(el, "r");
  const clean = (s: string) => s.replace(/_x([0-9a-f]{4})_/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  if (!runs.length) return { text: clean(kids(el, "t").map((t) => t.textContent ?? "").join("")) };
  const parts = runs.map((r) => ({ text: clean(kid(r, "t")?.textContent ?? ""), font: kid(r, "rPr") ? readFont(kid(r, "rPr"), theme) : undefined }));
  return { text: parts.map((p) => p.text).join(""), runs: parts };
}

// ------------------------------------------------------------------ sheets

/** Excel column width (characters of the default font) in px. */
const widthPx = (chars: number) => Math.round(chars * 7);
/** Points in px. */
const ptPx = (pt: number) => Math.round((pt * 4) / 3);

function readSheet(name: string, doc: Document, shared: { text: string; runs?: Run[] }[], styles: Style[], theme: string[]): Sheet {
  const visibleStyle = (s: number) => {
    const st = styles[s];
    return !!st && !!(st.fill || st.left || st.right || st.top || st.bottom);
  };
  const format = kid(doc, "sheetFormatPr");
  const baseWidth = num(format?.getAttribute("baseColWidth")) ?? 8;
  const sheet: Sheet = {
    name,
    rows: new Map(),
    lastRow: -1,
    lastCol: -1,
    colWidths: new Map(),
    defaultColWidth: num(format?.getAttribute("defaultColWidth")) ? widthPx(num(format?.getAttribute("defaultColWidth"))!) : Math.ceil((baseWidth * 7 + 5) / 8) * 8,
    rowHeights: new Map(),
    defaultRowHeight: ptPx(num(format?.getAttribute("defaultRowHeight")) ?? 15),
    hiddenRows: new Set(),
    hiddenCols: new Set(),
    merges: [],
    gridLines: !kids(kid(doc, "sheetViews"), "sheetView").some((v) => v.getAttribute("showGridLines") === "0" || v.getAttribute("showGridLines") === "false"),
  };
  for (const col of kids(kid(doc, "cols"), "col")) {
    const min = Number(col.getAttribute("min")) - 1;
    const max = Math.min(Number(col.getAttribute("max")) - 1, 16383);
    const width = num(col.getAttribute("width"));
    const hidden = flag(col, "hidden") && col.hasAttribute("hidden");
    // Ranges up to the last column (formatting whole rows) only need the used columns; stop early.
    for (let c = min; c <= Math.min(max, min + 1000); c++) {
      if (width !== undefined) sheet.colWidths.set(c, widthPx(width));
      if (hidden || width === 0) sheet.hiddenCols.add(c);
    }
  }
  let rowIndex = -1;
  for (const row of kids(kid(doc, "sheetData"), "row")) {
    rowIndex = num(row.getAttribute("r")) !== undefined ? Number(row.getAttribute("r")) - 1 : rowIndex + 1;
    const ht = num(row.getAttribute("ht"));
    if (ht !== undefined) sheet.rowHeights.set(rowIndex, ptPx(ht));
    if (row.hasAttribute("hidden") && flag(row, "hidden")) sheet.hiddenRows.add(rowIndex);
    const cells = new Map<number, Cell>();
    let colIndex = -1;
    for (const c of kids(row, "c")) {
      const ref = c.getAttribute("r");
      colIndex = ref ? parseRef(ref)[1] : colIndex + 1;
      const style = Number(c.getAttribute("s") ?? 0);
      const type = c.getAttribute("t") ?? "n";
      const v = kid(c, "v")?.textContent ?? undefined;
      const cell: Cell = { style };
      if (type === "s" && v !== undefined) {
        const s = shared[Number(v)];
        if (s) {
          cell.value = s.text;
          if (s.runs) cell.runs = s.runs;
        }
      } else if (type === "inlineStr") {
        const is = kid(c, "is");
        if (is) {
          const t = readText(is, theme);
          cell.value = t.text;
          if (t.runs) cell.runs = t.runs;
        }
      } else if (type === "b" && v !== undefined) cell.value = v === "1" || v === "true";
      else if (type === "e" && v !== undefined) {
        cell.value = v;
        cell.error = true;
      } else if ((type === "str" || type === "d") && v !== undefined) cell.value = v;
      else if (v !== undefined && v !== "") cell.value = Number(v);
      const hasValue = cell.value !== undefined && cell.value !== "";
      if (!hasValue && !style) continue;
      cells.set(colIndex, cell);
      if (hasValue || visibleStyle(style)) {
        sheet.lastRow = Math.max(sheet.lastRow, rowIndex);
        sheet.lastCol = Math.max(sheet.lastCol, colIndex);
      }
    }
    if (cells.size) sheet.rows.set(rowIndex, cells);
  }
  for (const m of kids(kid(doc, "mergeCells"), "mergeCell")) {
    const [from, to = from] = (m.getAttribute("ref") ?? "").split(":");
    const [r1, c1] = parseRef(from);
    const [r2, c2] = parseRef(to);
    if (r1 < 0 || r2 < 0) continue;
    sheet.merges.push({ row: r1, col: c1, rows: r2 - r1 + 1, cols: c2 - c1 + 1 });
    // A merge counts for the used range only where its first cell shows something.
    const first = sheet.rows.get(r1)?.get(c1);
    if (first && (first.value !== undefined || visibleStyle(first.style))) {
      sheet.lastRow = Math.max(sheet.lastRow, r2);
      sheet.lastCol = Math.max(sheet.lastCol, c2);
    }
  }
  return sheet;
}

/** Resolves a relationship target against the folder of the part that refers to it. */
function resolve(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function relationships(files: Record<string, Uint8Array>, part: string): Map<string, { target: string; type: string }> {
  const slash = part.lastIndexOf("/");
  const relsPath = `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
  const out = new Map<string, { target: string; type: string }>();
  const data = files[relsPath];
  if (!data) return out;
  for (const r of all(xml(strFromU8(data)), "Relationship")) {
    out.set(r.getAttribute("Id") ?? "", { target: resolve(part, r.getAttribute("Target") ?? ""), type: r.getAttribute("Type") ?? "" });
  }
  return out;
}

export function readWorkbook(data: Uint8Array): Workbook {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new Error("This is not an Excel workbook (XLSX): it is not a zip archive. Older .xls files are not supported.");
  }
  // Part names are case-insensitive in the package format.
  const lower = new Map(Object.keys(files).map((k) => [k.toLowerCase(), k]));
  const get = (path: string) => {
    const key = lower.get(path.toLowerCase());
    return key ? files[key] : undefined;
  };
  const read = (path: string | undefined) => {
    const d = path ? get(path) : undefined;
    return d ? xml(strFromU8(d)) : null;
  };
  const rootRels = relationships(files, "");
  const bookPath = [...rootRels.values()].find((r) => r.type.endsWith("/officeDocument"))?.target ?? "xl/workbook.xml";
  const book = read(bookPath);
  if (!book) throw new Error("This workbook has no workbook part; is it an XLSX file?");
  const rels = relationships(files, bookPath);
  const byType = (suffix: string) => [...rels.values()].find((r) => r.type.endsWith(suffix))?.target;

  const theme = themeColors(read(byType("/theme")));
  const { styles, font } = readStyles(read(byType("/styles")), theme);
  const sharedDoc = read(byType("/sharedStrings"));
  const shared = sharedDoc ? kids(sharedDoc, "si").map((si) => readText(si, theme)) : [];
  const date1904 = flag(kid(book, "workbookPr"), "date1904") && !!kid(book, "workbookPr")?.hasAttribute("date1904");

  const sheets: Sheet[] = [];
  for (const s of kids(kid(book, "sheets"), "sheet")) {
    if (["hidden", "veryHidden"].includes(s.getAttribute("state") ?? "")) continue;
    const id = s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? s.getAttribute("r:id");
    const rel = id ? rels.get(id) : undefined;
    // Chart sheets and dialog sheets have no cells.
    if (!rel || !rel.type.endsWith("/worksheet")) continue;
    const doc = read(rel.target);
    if (doc) sheets.push(readSheet(s.getAttribute("name") ?? "Sheet", doc, shared, styles, theme));
  }
  return { sheets, styles, date1904, font };
}
