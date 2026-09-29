import alerts from "markdown-it-github-alerts";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import { full as emoji } from "markdown-it-emoji";
import frontMatter from "markdown-it-front-matter";
import { parse as parseYaml } from "yaml";
import hljs from "highlight.js/lib/common";
import type { MarkdownIt } from "markdown-it";
import type { ViewerPlugin } from "../types";
import { escapeHtml } from "../types";

export const alertsPlugin: ViewerPlugin = {
  id: "alerts",
  name: "GitHub alerts",
  description: "> [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION] callouts",
  defaultEnabled: true,
  setup: (md) => void md.use(alerts),
};

export const taskListPlugin: ViewerPlugin = {
  id: "tasklists",
  name: "Task lists",
  description: "- [ ] / - [x] checkboxes",
  defaultEnabled: true,
  setup: (md) => void md.use(taskLists, { enabled: false }),
};

export const footnotePlugin: ViewerPlugin = {
  id: "footnotes",
  name: "Footnotes",
  description: "[^1] references and definitions",
  defaultEnabled: true,
  setup: (md) => void md.use(footnote),
};

export const emojiPlugin: ViewerPlugin = {
  id: "emoji",
  name: "Emoji shortcodes",
  description: ":smile: → 😄",
  defaultEnabled: true,
  setup: (md) => void md.use(emoji),
};

function frontMatterTable(raw: string): string {
  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch {
    return `<pre class="mdz-front-matter">${escapeHtml(raw)}</pre>`;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const cell = (v: unknown) =>
    escapeHtml(typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
  const entries = Object.entries(data as Record<string, unknown>);
  return (
    `<table class="mdz-front-matter"><thead><tr>${entries.map(([k]) => `<th>${escapeHtml(k)}</th>`).join("")}</tr></thead>` +
    `<tbody><tr>${entries.map(([, v]) => `<td>${cell(v)}</td>`).join("")}</tr></tbody></table>\n`
  );
}

export const frontMatterPlugin: ViewerPlugin = {
  id: "frontmatter",
  name: "Front matter as table",
  description: "Shows YAML front matter as a table like GitHub (hidden when disabled)",
  defaultEnabled: true,
  setup(md) {
    md.use(frontMatter, () => {});
    md.renderer.rules.front_matter = (tokens, idx) => frontMatterTable(tokens[idx].meta as unknown as string);
  },
};

/** Registered separately so disabling it still hides front matter instead of rendering it as text. */
export const frontMatterHiddenSetup = (md: MarkdownIt) => {
  md.use(frontMatter, () => {});
  md.renderer.rules.front_matter = () => "";
};

export const highlightPlugin: ViewerPlugin = {
  id: "highlight",
  name: "Syntax highlighting",
  description: "Colors code blocks (highlight.js, common languages)",
  defaultEnabled: true,
  setup(md) {
    md.set({
      highlight(code, lang) {
        const language = lang.toLowerCase();
        if (!language || !hljs.getLanguage(language)) return "";
        return hljs.highlight(code, { language, ignoreIllegals: true }).value;
      },
    });
  },
};
