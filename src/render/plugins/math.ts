import katex from "katex";
import texmath from "markdown-it-texmath";
import "katex/dist/katex.min.css";
import type { ViewerPlugin } from "../types";

export const mathPlugin: ViewerPlugin = {
  id: "math",
  name: "Math (KaTeX)",
  description: "$inline$, $$block$$ and ```math blocks",
  defaultEnabled: true,
  setup: (md) =>
    void md.use(texmath, {
      engine: katex,
      delimiters: ["dollars", "beg_end"],
      katexOptions: { throwOnError: false },
    }),
  fences: {
    math: (code) => katex.renderToString(code, { displayMode: true, throwOnError: false }) + "\n",
  },
};
