// Word plugin: mammoth turns the document's structure (headings, lists, tables, pictures)
// into HTML, shown by the app's Markdown view, so find, outline, pages and print work.

import mammoth from "mammoth";
import type { PluginApi, PluginInstance } from "../../src/plugins/api";

export { PLUGIN_API as api } from "../../src/plugins/api";

/** Each top-level element on its own line, so the view can lay them out as separate blocks. */
export async function docxToMarkdown(data: Uint8Array): Promise<string> {
  const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const { value } = await mammoth.convertToHtml({ arrayBuffer });
  const body = new DOMParser().parseFromString(`<body>${value}</body>`, "text/html").body;
  const blocks = [...body.children].map((child) => child.outerHTML.replace(/\r?\n/g, " "));
  return blocks.length ? blocks.join("\n\n") + "\n" : "*The document is empty.*\n";
}

export default function activate(api: PluginApi): PluginInstance {
  return { createView: (host) => api.createMarkdownView(host, docxToMarkdown) };
}
