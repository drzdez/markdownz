import markdownIt, { type MarkdownIt } from "markdown-it";
import anchor from "markdown-it-anchor";
import DOMPurify from "dompurify";
import { markerAnchor, markersToAnchors, parseMarkerText } from "../print/orientation";
import { fileSrc } from "../backend";
import { dirname, resolvePath } from "../paths";
import {
  alertsPlugin,
  emojiPlugin,
  footnotePlugin,
  frontMatterHiddenSetup,
  frontMatterPlugin,
  highlightPlugin,
  taskListPlugin,
} from "./plugins/basic";
import { graphvizPlugin, mermaidPlugin } from "./plugins/diagrams";
import { mathPlugin } from "./plugins/math";
import type { RenderContext, ViewerPlugin } from "./types";

/** All built-in plugins in settings order. Add new plugins here. */
export const PLUGINS: ViewerPlugin[] = [
  alertsPlugin,
  taskListPlugin,
  footnotePlugin,
  emojiPlugin,
  frontMatterPlugin,
  highlightPlugin,
  mathPlugin,
  mermaidPlugin,
  graphvizPlugin,
];

/** GitHub-compatible heading slugs, so links like `other.md#my-heading` work. */
export function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

export function isEnabled(plugin: ViewerPlugin, settings: Record<string, boolean>): boolean {
  return settings[plugin.id] ?? plugin.defaultEnabled;
}

export class Renderer {
  private md!: MarkdownIt;
  private active: ViewerPlugin[] = [];

  constructor(settings: Record<string, boolean>) {
    this.configure(settings);
  }

  configure(settings: Record<string, boolean>): void {
    this.active = PLUGINS.filter((p) => isEnabled(p, settings));
    const md = markdownIt({ html: true, linkify: true });
    md.use(anchor, { slugify, tabIndex: false });
    if (!this.active.includes(frontMatterPlugin)) frontMatterHiddenSetup(md);

    const fences = new Map<string, (code: string, info: string) => string>();
    for (const plugin of this.active) {
      plugin.setup?.(md);
      for (const [lang, render] of Object.entries(plugin.fences ?? {})) fences.set(lang, render);
    }
    md.core.ruler.after("block", "mdz_source_lines", sourceLines);
    const defaultHtmlBlock = md.renderer.rules.html_block!;
    md.renderer.rules.html_block = (tokens, idx, options, env, self) => {
      // An orientation marker on a line of its own becomes an anchor that knows its line.
      const token = tokens[idx];
      const text = token.content.trim().match(/^<!--\s*markdownz\s*:([^>]*?)-->$/i)?.[1];
      const marker = text === undefined ? null : parseMarkerText(text);
      return marker ? markerAnchor(marker, token.map?.[0]) + "\n" : defaultHtmlBlock(tokens, idx, options, env, self);
    };
    const defaultFence = md.renderer.rules.fence!;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const lang = token.info.trim().split(/\s+/, 1)[0].toLowerCase();
      const custom = fences.get(lang);
      return custom ? custom(token.content, token.info) : defaultFence(tokens, idx, options, env, self);
    };
    this.md = md;
  }

  /** Renders markdown into sanitized HTML (no DOM enhancements yet). */
  toHtml(source: string): string {
    // Orientation markers (<!-- markdownz: landscape -->) become invisible anchors for printing.
    return sanitize(markersToAnchors(this.md.render(source)));
  }

  /** Renders into a new detached element, including async plugin work (diagrams). */
  async render(source: string, ctx: RenderContext): Promise<HTMLElement> {
    const article = document.createElement("article");
    article.className = "markdown-body";
    article.innerHTML = this.toHtml(source);
    rewriteResources(article, ctx.docPath);
    for (const plugin of this.active) {
      try {
        await plugin.postRender?.(article, ctx);
      } catch (e) {
        console.error(`plugin ${plugin.id} failed`, e);
      }
    }
    return article;
  }
}

/**
 * Puts an invisible anchor with the source lines before every top-level block,
 * so orientation markers can be moved between blocks by editing just their line.
 */
type CoreState = Parameters<Parameters<MarkdownIt["core"]["ruler"]["after"]>[2]>[0];

function sourceLines(state: CoreState): void {
  const out: CoreState["tokens"] = [];
  for (const token of state.tokens) {
    const opens = token.level === 0 && token.nesting >= 0 && token.map;
    const marker = token.type === "html_block" && /^\s*<!--\s*markdownz\s*:/i.test(token.content);
    if (opens && !marker) {
      const anchor = new state.Token("html_block", "", 0);
      anchor.content = `<span class="mdz-src" data-line="${token.map![0]}" data-end="${token.map![1]}"></span>\n`;
      out.push(anchor);
    }
    out.push(token);
  }
  state.tokens.splice(0, state.tokens.length, ...out);
}

export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    // Documents must not restyle or script the viewer itself.
    FORBID_TAGS: ["style", "form", "button", "textarea", "select", "iframe", "object", "embed", "link", "meta", "base"],
  });
}

/** Points relative image/media sources at the local file next to the document. */
function rewriteResources(root: HTMLElement, docPath: string): void {
  const dir = dirname(docPath);
  for (const el of root.querySelectorAll<HTMLImageElement | HTMLSourceElement>("img[src], video[src], audio[src], source[src]")) {
    const src = el.getAttribute("src")!;
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src) && !/^[A-Za-z]:[\\/]/.test(src)) continue;
    let path = src.split(/[?#]/, 1)[0];
    try {
      path = decodeURIComponent(path);
    } catch {
      /* keep as is */
    }
    el.setAttribute("src", fileSrc(resolvePath(dir, path)));
  }
}
