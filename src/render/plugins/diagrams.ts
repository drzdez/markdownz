import DOMPurify from "dompurify";
import type { ViewerPlugin } from "../types";
import { diagramError, diagramFigure, diagramSource } from "../types";

function sources(root: HTMLElement, kind: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`pre.mdz-diagram-src[data-kind="${kind}"]`)];
}

let uid = 0;

export const mermaidPlugin: ViewerPlugin = {
  id: "mermaid",
  name: "Mermaid diagrams",
  description: "```mermaid flowcharts, sequence, class, state, gantt, ER … diagrams",
  defaultEnabled: true,
  fences: { mermaid: (code) => diagramSource("mermaid", code) },
  async postRender(root, ctx) {
    const blocks = sources(root, "mermaid");
    if (!blocks.length) return;
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: ctx.theme === "dark" ? "dark" : "default",
    });
    for (const pre of blocks) {
      const code = pre.textContent ?? "";
      const id = `mdz-mermaid-${++uid}`;
      try {
        const { svg } = await mermaid.render(id, code);
        pre.replaceWith(diagramFigure("mermaid", svg));
      } catch (e) {
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
        pre.replaceWith(diagramError("Mermaid", e instanceof Error ? e.message : String(e), code));
      }
    }
  },
};

let vizInstance: Promise<import("@viz-js/viz").Viz> | undefined;

export const graphvizPlugin: ViewerPlugin = {
  id: "graphviz",
  name: "Graphviz diagrams",
  description: "```dot / ```graphviz blocks rendered offline (Viz.js)",
  defaultEnabled: true,
  fences: {
    dot: (code) => diagramSource("graphviz", code),
    graphviz: (code) => diagramSource("graphviz", code),
  },
  async postRender(root, ctx) {
    const blocks = sources(root, "graphviz");
    if (!blocks.length) return;
    vizInstance ??= import("@viz-js/viz").then((m) => m.instance());
    const viz = await vizInstance;
    // Theme-aware defaults; attributes set in the DOT source still win.
    const fg = ctx.theme === "dark" ? "#d1d7e0" : "#1f2328";
    const defaults = { color: fg, fontcolor: fg };
    for (const pre of blocks) {
      const code = pre.textContent ?? "";
      const result = viz.render(code, {
        format: "svg",
        graphAttributes: { bgcolor: "transparent", ...defaults },
        nodeAttributes: defaults,
        edgeAttributes: defaults,
      });
      if (result.status === "success") {
        const svg = DOMPurify.sanitize(result.output, { USE_PROFILES: { svg: true, svgFilters: true } });
        pre.replaceWith(diagramFigure("graphviz", svg));
      } else {
        const message = result.errors.map((e) => e.message).join("; ") || "render failed";
        pre.replaceWith(diagramError("Graphviz", message, code));
      }
    }
  },
};
