// Splits a continuously rendered HTML document into pages.

/**
 * Chooses page breaks. `candidates` are y positions (px from the document top)
 * where a break may happen, e.g. after a paragraph, list item, table row or code
 * line. A break is never placed directly after a heading (`avoid`) and pages are
 * filled at least to 40 % before a break is accepted; when no candidate fits, the
 * page is cut at its full height.
 * Returns [start, end) ranges in px.
 */
export function paginate(candidates: number[], total: number, pageHeight: number, avoid: Set<number> = new Set()): [number, number][] {
  const points = [...new Set(candidates)].filter((c) => c > 0 && c < total).sort((a, b) => a - b);
  const pages: [number, number][] = [];
  let start = 0;
  while (total - start > 0.5) {
    const limit = start + pageHeight;
    if (limit >= total) {
      pages.push([start, total]);
      break;
    }
    const minimum = start + pageHeight * 0.4;
    let end = limit;
    for (let i = points.length - 1; i >= 0; i--) {
      const c = points[i];
      if (c > limit) continue;
      if (c < minimum) break;
      if (!avoid.has(c)) {
        end = c;
        break;
      }
    }
    pages.push([start, end]);
    start = end;
  }
  return pages;
}

const BLOCKS = [
  "p", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "figure", "table", "hr", "img",
  "dl", "dt", "dd", "details", ".katex-display", ".markdown-alert", ".mdz-diagram", ".mdz-diagram-error",
].join(", ");

/** Measures break candidates of an article that is laid out in the DOM. */
export function measureBreaks(article: HTMLElement): { candidates: number[]; avoid: Set<number>; total: number } {
  const top = article.getBoundingClientRect().top;
  const candidates: number[] = [];
  const avoid = new Set<number>();
  for (const el of article.querySelectorAll<HTMLElement>(BLOCKS)) {
    const rect = el.getBoundingClientRect();
    if (!rect.height) continue;
    const bottom = Math.round(rect.bottom - top);
    candidates.push(bottom);
    if (/^H[1-6]$/.test(el.tagName)) avoid.add(bottom);
    if (el.tagName === "PRE") {
      // Long code blocks may break between lines.
      const style = getComputedStyle(el);
      const line = parseFloat(style.lineHeight) || 20;
      const first = rect.top - top + parseFloat(style.paddingTop);
      for (let y = first + line; y < rect.bottom - top - line / 2; y += line) candidates.push(Math.round(y));
    }
  }
  return { candidates, avoid, total: Math.ceil(article.scrollHeight) };
}
