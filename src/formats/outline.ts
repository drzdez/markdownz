import type { OutlineItem } from "./types";

/** How deep list items (bullets) go into the table of contents. */
const OUTLINE_LIST_DEPTH = 2;

/**
 * Table of contents of a rendered Markdown document: the headings, and with
 * `lists` the list items under them (nested ones up to OUTLINE_LIST_DEPTH),
 * each one level below the heading it follows. Items in tables, quotes,
 * cards and footnotes are left out.
 */
export function markdownOutline(article: HTMLElement, scroller: HTMLElement, options: { lists?: boolean } = {}): OutlineItem[] {
  const selector = options.lists ? "h1, h2, h3, h4, h5, h6, li" : "h1, h2, h3, h4, h5, h6";
  const position = (e: HTMLElement) => () => e.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  const items: OutlineItem[] = [];
  let headingLevel = 0;
  for (const e of article.querySelectorAll<HTMLElement>(selector)) {
    if (e.tagName !== "LI") {
      headingLevel = Number(e.tagName[1]);
      items.push({ title: e.textContent ?? "", level: headingLevel, position: position(e), activate: () => e.scrollIntoView({ block: "start" }) });
      continue;
    }
    if (e.closest("table, blockquote, details, .mdz-mail-card, .mdz-mail-files, .footnotes, nav")) continue;
    let depth = 0;
    for (let p = e.parentElement; p && p !== article; p = p.parentElement) if (p.tagName === "LI") depth++;
    if (depth >= OUTLINE_LIST_DEPTH) continue;
    const own = e.cloneNode(true) as HTMLElement;
    own.querySelectorAll("ul, ol").forEach((l) => l.remove());
    const title = (own.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    items.push({
      title: title.length > 120 ? `${title.slice(0, 119)}…` : title,
      level: headingLevel + 1 + depth,
      kind: "item",
      depth,
      position: position(e),
      activate: () => e.scrollIntoView({ block: "start" }),
    });
  }
  return items;
}
