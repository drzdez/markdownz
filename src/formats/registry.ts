import { extname } from "../paths";
import type { Config } from "../state";
import { markdownFormat } from "./markdown";
import { pdfFormat } from "./pdf";
import type { FormatPlugin } from "./types";

/** All document formats in settings order. Add new formats here. */
export const FORMATS: FormatPlugin[] = [markdownFormat, pdfFormat];

export function isFormatEnabled(format: FormatPlugin, config: Config): boolean {
  return config.formats[format.id] ?? format.defaultEnabled;
}

/** The enabled format that can show `path`, or null. */
export function formatFor(path: string, config: Config): FormatPlugin | null {
  const ext = extname(path);
  return FORMATS.find((f) => f.extensions.includes(ext) && isFormatEnabled(f, config)) ?? null;
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
