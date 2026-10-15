// Formats shown by turning the file into Markdown: text and code, CSV, diagram
// sources and Jupyter notebooks. They get everything the Markdown view has
// (find, table of contents, pages, print) without code of their own. Markers
// are never written into these files; your exceptions work as usual.

import { basename, extname } from "../paths";
import { createMarkdownView } from "./markdown";
import type { FormatPlugin } from "./types";

/** Above this size code is shown without colours (highlighting would take seconds). */
const HIGHLIGHT_LIMIT = 512 * 1024;
/** Text beyond this size is not shown (the view would be too slow); the rest opens elsewhere. */
const TEXT_LIMIT = 8 * 1024 * 1024;

/** A fenced code block that cannot be closed early by backticks in the code itself. */
export function fence(code: string, lang: string): string {
  const longest = Math.max(
    2,
    ...[...code.matchAll(/`+/g)].map((m) => m[0].length),
  );
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${lang}\n${code.replace(/\n$/, "")}\n${ticks}\n`;
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function limit(text: string): { text: string; note: string } {
  if (text.length <= TEXT_LIMIT) return { text, note: "" };
  const cut = text.lastIndexOf("\n", TEXT_LIMIT);
  return {
    text: text.slice(0, cut > 0 ? cut : TEXT_LIMIT),
    note: `\n> [!NOTE]\n> Only the first ${Math.round(TEXT_LIMIT / 1024 / 1024)} MB are shown; open the file with another application (Ctrl+Shift+O) for the rest.\n`,
  };
}

// ------------------------------------------------------------ text and code

/** File extension (or file name) → highlight.js language; "text" shows it plain. */
const LANGUAGES: Record<string, string> = {
  txt: "text",
  text: "text",
  log: "text",
  out: "text",
  json: "json",
  jsonc: "json",
  geojson: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  properties: "ini",
  env: "ini",
  editorconfig: "ini",
  xml: "xml",
  xsd: "xml",
  xsl: "xml",
  xslt: "xml",
  csproj: "xml",
  props: "xml",
  targets: "xml",
  resx: "xml",
  config: "xml",
  plist: "xml",
  html: "xml",
  htm: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  py: "python",
  pyw: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  vb: "vbnet",
  fs: "fsharp",
  fsx: "fsharp",
  php: "php",
  rb: "ruby",
  pl: "perl",
  pm: "perl",
  lua: "lua",
  r: "r",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  bat: "dos",
  cmd: "dos",
  diff: "diff",
  patch: "diff",
  makefile: "makefile",
  mk: "makefile",
  dockerfile: "dockerfile",
  gitignore: "text",
  gitattributes: "text",
};

/** The language for a path: by extension, or by the whole name for files like Makefile or Dockerfile. */
export function languageFor(path: string): string | null {
  const ext = extname(path);
  if (ext && LANGUAGES[ext]) return LANGUAGES[ext];
  const name = basename(path).toLowerCase().replace(/^\./, "");
  return LANGUAGES[name] ?? null;
}

export function codeToMarkdown(text: string, path: string): string {
  const { text: shown, note } = limit(text);
  const lang = languageFor(path) ?? "text";
  return fence(shown, shown.length > HIGHLIGHT_LIMIT ? "text" : lang) + note;
}

// ------------------------------------------------------------ CSV and TSV

/** Splits delimited text into rows (RFC 4180: quoted fields may hold delimiters, quotes and line breaks). */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The delimiter of a CSV file: the one that splits the first lines into the most, equal columns. */
export function guessDelimiter(text: string, path: string): string {
  if (extname(path) === "tsv" || extname(path) === "tab") return "\t";
  const sample = text.split(/\r?\n/, 10).filter((l) => l.trim());
  let best = ",";
  let bestScore = 0;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = sample.map((l) => l.split(d).length - 1);
    const min = Math.min(...counts);
    const score =
      min > 0 && counts.every((c) => c === counts[0]) ? min * 2 : min;
    if (score > bestScore) [best, bestScore] = [d, score];
  }
  return best;
}

/** CSV as an HTML table (one line per row, so Markdown keeps it a single block); the first row is the header. */
export function csvToMarkdown(text: string, path: string): string {
  const { text: shown, note } = limit(text);
  const rows = parseDelimited(shown, guessDelimiter(shown, path)).filter((r) =>
    r.some((c) => c.trim()),
  );
  if (!rows.length) return "*The file is empty.*\n";
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (tag: string, value: string) => {
    const number = /^\s*[-+]?[\d\s.,]+%?\s*$/.test(value) && /\d/.test(value);
    return `<${tag}${number ? ' align="right"' : ""}>${escapeHtml(value).replace(/\r?\n/g, "<br>")}</${tag}>`;
  };
  const line = (r: string[], tag: string) =>
    `<tr>${Array.from({ length: width }, (_, i) => cell(tag, r[i] ?? "")).join("")}</tr>`;
  const [head, ...body] = rows;
  const summary = `*${body.length} rows, ${width} columns*\n\n`;
  return `${summary}<table><thead>${line(head, "th")}</thead><tbody>\n${body.map((r) => line(r, "td")).join("\n")}\n</tbody></table>\n${note}`;
}

// ------------------------------------------------------------ Jupyter notebooks

interface NotebookOutput {
  output_type: string;
  text?: string | string[];
  data?: Record<string, string | string[]>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

interface NotebookCell {
  cell_type: string;
  source: string | string[];
  outputs?: NotebookOutput[];
  attachments?: Record<string, Record<string, string>>;
}

const joined = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value.join("") : (value ?? "");
// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
const base64 = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)));

function outputToMarkdown(output: NotebookOutput): string {
  if (output.output_type === "stream")
    return fence(stripAnsi(joined(output.text)), "text");
  if (output.output_type === "error")
    return fence(
      stripAnsi(
        (output.traceback ?? [`${output.ename}: ${output.evalue}`]).join("\n"),
      ),
      "text",
    );
  const data = output.data ?? {};
  for (const type of ["image/png", "image/jpeg", "image/gif"]) {
    if (data[type])
      return `<img src="data:${type};base64,${joined(data[type]).replace(/\s/g, "")}" alt="output">\n`;
  }
  if (data["image/svg+xml"])
    return `<img src="data:image/svg+xml;base64,${base64(joined(data["image/svg+xml"]))}" alt="output">\n`;
  // HTML output (e.g. a table of pandas) is sanitized like raw HTML in Markdown.
  if (data["text/html"])
    return `<div class="mdz-nb-html">\n${joined(data["text/html"])
      .replace(/\n\s*\n/g, "\n")
      .trim()}\n</div>\n`;
  if (data["text/markdown"]) return `${joined(data["text/markdown"])}\n`;
  if (data["text/latex"]) return `${joined(data["text/latex"])}\n`;
  if (data["text/plain"])
    return fence(stripAnsi(joined(data["text/plain"])), "text");
  return "";
}

/** A notebook as Markdown: Markdown cells as they are, code cells as code with their outputs below. */
export function notebookToMarkdown(text: string): string {
  const notebook = JSON.parse(text) as {
    cells?: NotebookCell[];
    metadata?: {
      language_info?: { name?: string };
      kernelspec?: { language?: string };
    };
  };
  const lang = (
    notebook.metadata?.language_info?.name ??
    notebook.metadata?.kernelspec?.language ??
    "python"
  ).toLowerCase();
  const parts: string[] = [];
  for (const cell of notebook.cells ?? []) {
    const source = joined(cell.source);
    if (cell.cell_type === "markdown") {
      // Pictures pasted into a cell are stored in the notebook as attachments.
      const withPictures = source.replace(
        /\(attachment:([^)\s]+)\)/g,
        (all, name: string) => {
          const files = cell.attachments?.[name];
          const type = files && Object.keys(files)[0];
          return type
            ? `(data:${type};base64,${joined(files[type]).replace(/\s/g, "")})`
            : all;
        },
      );
      parts.push(withPictures);
    } else if (cell.cell_type === "code") {
      if (source.trim()) parts.push(fence(source, lang));
      for (const output of cell.outputs ?? [])
        parts.push(outputToMarkdown(output));
    } else if (source.trim()) parts.push(fence(source, "text"));
  }
  return parts.filter((p) => p.trim()).join("\n\n");
}

// ------------------------------------------------------------ the formats

export const textFormat: FormatPlugin = {
  id: "text",
  name: "Text and code",
  description:
    "Plain text, logs, JSON, YAML, XML, source code and scripts, with colours (never run)",
  extensions: Object.keys(LANGUAGES).filter(
    (e) =>
      ![
        "makefile",
        "dockerfile",
        "gitignore",
        "gitattributes",
        "editorconfig",
      ].includes(e),
  ),
  fileNames: [
    "makefile",
    "dockerfile",
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
  ],
  defaultEnabled: true,
  createView: (host) => createMarkdownView(host, codeToMarkdown),
};

export const csvFormat: FormatPlugin = {
  id: "csv",
  name: "CSV tables",
  description:
    "Comma, semicolon or tab separated values as a table; wide tables print like tables in Markdown",
  extensions: ["csv", "tsv", "tab"],
  defaultEnabled: true,
  createView: (host) => createMarkdownView(host, csvToMarkdown),
};

export const diagramFormat: FormatPlugin = {
  id: "diagram",
  name: "Diagram sources",
  description:
    "Mermaid (.mmd) and Graphviz (.dot, .gv) files drawn as diagrams",
  extensions: ["mmd", "mermaid", "dot", "gv"],
  defaultEnabled: true,
  createView: (host) =>
    createMarkdownView(host, (text, path) =>
      fence(text, ["dot", "gv"].includes(extname(path)) ? "dot" : "mermaid"),
    ),
};

export const notebookFormat: FormatPlugin = {
  id: "notebook",
  name: "Jupyter notebooks",
  description:
    "Notebooks (.ipynb) with their text, code and saved outputs (nothing is run)",
  extensions: ["ipynb"],
  defaultEnabled: true,
  createView: (host) => createMarkdownView(host, notebookToMarkdown),
};
