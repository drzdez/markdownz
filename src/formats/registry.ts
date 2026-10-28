import { basename, extname } from "../paths";
import type { Config } from "../state";
import { csvFormat, diagramFormat, notebookFormat, textFormat } from "./converted";
import { imageFormat } from "./image";
import { markdownFormat } from "./markdown";
import { pdfFormat } from "./pdf";
import { projectFormat } from "./project";
import type { FormatPlugin } from "./types";

/** All document formats in settings order: the built-in ones (add new ones here), then the installed plugins. */
export const FORMATS: FormatPlugin[] = [markdownFormat, pdfFormat, imageFormat, textFormat, csvFormat, diagramFormat, notebookFormat, projectFormat];

/** Adds an installed plugin's format, or replaces it after an update. */
export function registerFormat(format: FormatPlugin): void {
  const i = FORMATS.findIndex((f) => f.id === format.id);
  if (i >= 0) FORMATS[i] = format;
  else FORMATS.push(format);
}

export function unregisterFormat(id: string): void {
  const i = FORMATS.findIndex((f) => f.id === id);
  if (i >= 0) FORMATS.splice(i, 1);
}

export function isFormatEnabled(format: FormatPlugin, config: Config): boolean {
  return config.formats[format.id] ?? format.defaultEnabled;
}

/** The enabled format that can show `path`, or null. */
export function formatFor(path: string, config: Config): FormatPlugin | null {
  const ext = extname(path);
  const name = basename(path).toLowerCase();
  return FORMATS.find((f) => (f.extensions.includes(ext) || f.fileNames?.includes(name)) && isFormatEnabled(f, config)) ?? null;
}

/** File dialog filters for the enabled formats. */
export function fileFilters(config: Config): { name: string; extensions: string[] }[] {
  const enabled = FORMATS.filter((f) => isFormatEnabled(f, config));
  return [
    { name: "All supported", extensions: enabled.flatMap((f) => f.extensions) },
    ...enabled.map((f) => ({ name: f.name, extensions: f.extensions })),
    { name: "All files", extensions: ["*"] },
  ];
}
