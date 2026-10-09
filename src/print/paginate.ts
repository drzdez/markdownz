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
  return paginateMixed(candidates, total, pageHeight, pageHeight, [], avoid).map((p) => [p.start, p.end]);
}

/** A block wider than portrait text, e.g. a table laid out for a landscape page (px from the document top). */
export interface WideBlock {
  top: number;
  bottom: number;
}

/** Header rows of a table (px from the document top): `top`–`bottom`; the table ends at `end`. */
export interface TableHeader {
  top: number;
  bottom: number;
  end: number;
}

export interface MixedPage {
  start: number;
  end: number;
  landscape: boolean;
  /** Header rows repeated at the top of a page that starts inside a table. */
  header?: { top: number; bottom: number };
  /** Index (in `wide`) of the block that made the page landscape. */
  cause?: number;
}

/**
 * Like paginate(), but pages showing a wide block are landscape pages, which
 * hold less height (`landscapeHeight`). The text keeps its width and simply
 * continues: a landscape page starts where the previous page ended, even in
 * the middle of a section. A wide block that would start low on a portrait
 * page moves to the next (landscape) page, since a portrait page cannot show it.
 */
export function paginateMixed(
  candidates: number[],
  total: number,
  portraitHeight: number,
  landscapeHeight: number,
  wide: WideBlock[],
  avoid: Set<number> = new Set(),
  headers: TableHeader[] = [],
  /** Positions where a new page must start (page break markers). */
  breaks: number[] = [],
  /** Blocks that must be on portrait pages (an exception): a landscape page ends before them. */
  portrait: WideBlock[] = [],
  /** Blocks that cannot be split (diagrams, pictures, math): moved to the next page when they fit one. */
  whole: WideBlock[] = [],
): MixedPage[] {
  const points = [...new Set(candidates)].filter((c) => c > 0 && c < total).sort((a, b) => a - b);
  const blocks = wide.map((block, index) => ({ ...block, index })).sort((a, b) => a.top - b.top);
  const forced = [...breaks].sort((a, b) => a - b);
  const pages: MixedPage[] = [];

  /** Best break for a page starting at `start` that may end at `limit` at the latest. */
  const breakFor = (start: number, height: number, limit: number): number => {
    const minimum = start + height * 0.4;
    for (let i = points.length - 1; i >= 0; i--) {
      const c = points[i];
      if (c > limit) continue;
      if (c < minimum) break;
      if (!avoid.has(c)) return c;
    }
    return limit;
  };

  let start = 0;
  while (total - start > 0.5) {
    // (Block edges and break positions are rounded differently; a block ending within 2 px is over.)
    const next = blocks.find((b) => b.bottom > start + 2);
    const keep = portrait.find((b) => b.top <= start + 0.5 && start < b.bottom - 0.5);
    // A diagram too tall for a landscape page that comes before the wide block keeps this page portrait.
    const tall = whole.find((b) => b.top > start + 0.5 && b.top < start + landscapeHeight && b.bottom > start + landscapeHeight);
    const landscape = !keep && !!next && next.top < start + landscapeHeight && !(tall && next.top >= tall.top);
    // A page starting inside a table repeats its header rows, which take room from the page.
    const repeated = headers.find((h) => h.bottom <= start + 0.5 && start < h.end - 0.5);
    const header = repeated ? { top: repeated.top, bottom: repeated.bottom } : undefined;
    const height = (landscape ? landscapeHeight : portraitHeight) - (header ? header.bottom - header.top : 0);
    let limit = start + height;
    // A portrait page ends right before a wide block starting on it.
    if (!landscape && next && next.top < limit) limit = next.top;
    // A diagram or picture crossing the end of the page moves to the next page if it fits there.
    // (A landscape page is lower; the next page may be portrait again, so the taller height counts.)
    const tallest = Math.max(portraitHeight, landscapeHeight);
    const crossing = whole.find((b) => b.top > start + 0.5 && b.top < limit && b.bottom > limit && b.bottom - b.top <= tallest);
    if (crossing) limit = crossing.top;
    // A landscape page ends before a block that must stay portrait.
    const portraitNext = landscape ? portrait.find((b) => b.top > start + 0.5 && b.top < limit) : undefined;
    const pageBreak = forced.find((b) => b > start + 0.5 && b < limit) ?? portraitNext?.top;
    if (pageBreak !== undefined) limit = pageBreak;
    const extra = { ...(header && { header }), ...(landscape && { cause: next!.index }) };
    if (limit >= total) {
      pages.push({ start, end: total, landscape, ...extra });
      break;
    }
    // Before a wide block the page may end earlier, so a heading moves along with the block.
    const end = pageBreak !== undefined ? limit : breakFor(start, height, limit);
    pages.push({ start, end, landscape, ...extra });
    start = end;
  }
  return pages;
}

/**
 * Splits table columns into groups that fit `limit` px: the first column (the
 * row labels) is repeated in every group. Returns indexes of the other columns.
 */
export function groupColumns(widths: number[], limit: number): number[][] {
  const first = widths[0] ?? 0;
  const groups: number[][] = [];
  let group: number[] = [];
  let used = first;
  for (let i = 1; i < widths.length; i++) {
    if (group.length && used + widths[i] > limit) {
      groups.push(group);
      group = [];
      used = first;
    }
    group.push(i);
    used += widths[i];
  }
  if (group.length || !groups.length) groups.push(group);
  return groups;
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
