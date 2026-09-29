import type { MarkdownIt } from "markdown-it";

export interface RenderContext {
  /** Absolute path of the rendered document (used to resolve relative resources). */
  docPath: string;
  theme: "light" | "dark";
}

/**
 * A viewer plugin. All optional hooks run only while the plugin is enabled.
 *
 * - `setup` extends the markdown-it parser (syntax, renderer rules).
 * - `fences` render fenced code blocks by language (```mermaid, ```dot ...).
 *   Return an HTML placeholder; the output passes through the sanitizer.
 * - `postRender` enhances the sanitized DOM (diagrams, lazy work, events).
 */
export interface ViewerPlugin {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  setup?(md: MarkdownIt): void;
  fences?: Record<string, (code: string, info: string) => string>;
  postRender?(root: HTMLElement, ctx: RenderContext): Promise<void> | void;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Placeholder for diagram sources that `postRender` later replaces with an SVG. */
export function diagramSource(kind: string, code: string): string {
  return `<pre class="mdz-diagram-src" data-kind="${kind}">${escapeHtml(code)}</pre>\n`;
}

export function diagramError(kind: string, message: string, code: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "mdz-diagram-error";
  const title = document.createElement("strong");
  title.textContent = `${kind} error: ${message}`;
  const pre = document.createElement("pre");
  pre.textContent = code;
  box.append(title, pre);
  return box;
}

export function diagramFigure(kind: string, svg: string | SVGElement): HTMLElement {
  const fig = document.createElement("figure");
  fig.className = "mdz-diagram";
  fig.dataset.kind = kind;
  fig.title = "Click to enlarge";
  if (typeof svg === "string") fig.innerHTML = svg;
  else fig.append(svg);
  return fig;
}
