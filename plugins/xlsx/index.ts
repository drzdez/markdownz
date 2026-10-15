// Excel plugin: read-excel-file reads the values of every sheet; each becomes a heading and a
// table with column letters and row numbers, shown by the app's Markdown view.

import readXlsxFile from "read-excel-file/browser";
import type { PluginApi, PluginInstance } from "../../src/plugins/api";

export { PLUGIN_API as api } from "../../src/plugins/api";

const ROW_LIMIT = 20000;

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A, B, …, Z, AA, AB, … */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "<td></td>";
  if (typeof value === "number") return `<td align="right">${value.toLocaleString(undefined, { maximumFractionDigits: 10 })}</td>`;
  if (typeof value === "boolean") return `<td align="center">${value ? "TRUE" : "FALSE"}</td>`;
  if (value instanceof Date) {
    const time = value.getUTCHours() || value.getUTCMinutes() || value.getUTCSeconds();
    return `<td align="right">${escape(time ? value.toISOString().slice(0, 19).replace("T", " ") : value.toISOString().slice(0, 10))}</td>`;
  }
  return `<td>${escape(String(value)).replace(/\r?\n/g, "<br>")}</td>`;
}

export async function xlsxToMarkdown(data: Uint8Array): Promise<string> {
  const sheets = await readXlsxFile(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  const parts: string[] = [];
  for (const { sheet, data: rows } of sheets) {
    parts.push(`## ${sheet.replace(/[\\`*_#[\]<>]/g, "\\$&")}`);
    if (!rows.length) {
      parts.push("*The sheet is empty.*");
      continue;
    }
    const width = Math.max(...rows.map((r) => r.length));
    const shown = rows.slice(0, ROW_LIMIT);
    const head = `<tr><th></th>${Array.from({ length: width }, (_, i) => `<th>${columnName(i)}</th>`).join("")}</tr>`;
    const body = shown.map((r, i) => `<tr><th align="right">${i + 1}</th>${Array.from({ length: width }, (_, c) => cell(r[c])).join("")}</tr>`);
    parts.push(`*${rows.length} rows, ${width} columns*`);
    parts.push(`<table><thead>${head}</thead><tbody>\n${body.join("\n")}\n</tbody></table>`);
    if (rows.length > ROW_LIMIT) parts.push(`*Only the first ${ROW_LIMIT} rows are shown.*`);
  }
  return parts.join("\n\n") + "\n";
}

export default function activate(api: PluginApi): PluginInstance {
  return { createView: (host) => api.createMarkdownView(host, xlsxToMarkdown) };
}
