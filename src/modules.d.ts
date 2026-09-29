// Type shims for markdown-it plugins that ship without TypeScript declarations.
declare module "markdown-it-footnote" {
  import type { MarkdownIt } from "markdown-it";
  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}

declare module "markdown-it-task-lists" {
  import type { MarkdownIt } from "markdown-it";
  const plugin: (md: MarkdownIt, options?: { enabled?: boolean; label?: boolean; labelAfter?: boolean }) => void;
  export default plugin;
}

declare module "markdown-it-texmath" {
  import type { MarkdownIt } from "markdown-it";
  const plugin: (md: MarkdownIt, options?: {
    engine?: unknown;
    delimiters?: string | string[];
    katexOptions?: Record<string, unknown>;
  }) => void;
  export default plugin;
}

declare module "markdown-it-emoji" {
  import type { MarkdownIt } from "markdown-it";
  type EmojiPlugin = (md: MarkdownIt, options?: Record<string, unknown>) => void;
  export const full: EmojiPlugin;
  export const light: EmojiPlugin;
  export const bare: EmojiPlugin;
}
