// Page orientation of a Markdown document on paper: wide tables (print
// settings), markers in the file and your exceptions, resolved in that order of
// priority (see print/orientation.ts), with an explanation for every page.

import type { Orientation, WideTables } from "../print/imposition";
import type { MixedPage, WideBlock } from "../print/paginate";
import {
  decide,
  makeAnchor,
  resolveMarkers,
  sameAnchor,
  SOURCE_TEXT,
  type BlockAnchor,
  type Decision,
  type Item,
  type LocalException,
  type MarkerValue,
  type Source,
} from "../print/orientation";
import type { PageNotes } from "./types";
import type { PaperWide } from "./wideObjects";

interface Block {
  element: HTMLElement;
  anchor: BlockAnchor;
  label: string;
  local?: Orientation;
  marker?: Orientation;
  decision: Decision;
}

const SETTINGS_TEXT: Record<WideTables, string> = {
  landscape: "wide tables get landscape pages",
  shrink: "wide tables are shrunk to fit",
  none: "wide tables are left as they are",
};

function describe(element: HTMLElement): string {
  const row = element.tagName === "TABLE" ? (element as HTMLTableElement).rows[0] : null;
  const text = (row ? [...row.cells].map((c) => c.textContent?.trim()).join(" | ") : element.textContent) ?? "";
  const short = text.replace(/\s+/g, " ").trim();
  const quote = short ? ` “${short.length > 40 ? `${short.slice(0, 40)}…` : short}”` : "";
  const kind: Record<string, string> = { TABLE: "table", PRE: "code block", P: "paragraph", UL: "list", OL: "list", BLOCKQUOTE: "quote", FIGURE: "diagram" };
  return (/^H[1-6]$/.test(element.tagName) ? "heading" : (kind[element.tagName] ?? "block")) + quote;
}

/**
 * Reads the blocks of a rendered article (marking each with data-mdz-block),
 * the markers between them and your exceptions, and decides per block.
 * `portrait`: the pages are portrait, so blocks can be turned to landscape.
 */
export function planOrientation(article: HTMLElement, locals: LocalException[], settings: WideTables, portrait: boolean) {
  const items: Item[] = [];
  const elements: HTMLElement[] = [];
  let heading = "";
  const anchors: BlockAnchor[] = [];
  for (const child of [...article.children] as HTMLElement[]) {
    if (child.classList.contains("mdz-mark")) {
      items.push({ mark: child.dataset.mdz as MarkerValue });
      continue;
    }
    child.dataset.mdzBlock = String(elements.length);
    anchors.push(makeAnchor(child.tagName, heading, child.textContent ?? ""));
    if (/^H[1-6]$/.test(child.tagName)) heading = child.textContent ?? "";
    elements.push(child);
    items.push({ block: true });
  }
  const markers = resolveMarkers(items);
  // Markers inside paragraphs or lists cannot be placed between blocks.
  const misplaced = article.querySelectorAll(":scope * .mdz-mark").length;
  const matched = new Set<LocalException>();
  const blocks: Block[] = elements.map((element, i) => {
    const local = locals.find((l) => !matched.has(l) && sameAnchor(l.anchor, anchors[i]));
    if (local) matched.add(local);
    const marker = markers.orientation[i];
    return { element, anchor: anchors[i], label: describe(element), local: local?.orientation, marker, decision: decide(local?.orientation, marker) };
  });
  const orphans = locals.filter((l) => !matched.has(l));
  const blockOf = (element: Element): Block | undefined => blocks[Number(element.closest<HTMLElement>("[data-mdz-block]")?.dataset.mdzBlock)];

  /** Wide tables mode for an object, after exceptions. */
  const modeFor = (element: HTMLElement): WideTables => {
    const forced = blockOf(element)?.decision.orientation;
    if (portrait && forced === "landscape") return "landscape";
    if (portrait && forced === "portrait") return settings === "none" ? "none" : "shrink";
    return settings;
  };

  /** After the layout: blocks needing landscape pages, page breaks, and the explanations. */
  const finish = (fitted: { wide: PaperWide[]; overflowing: Set<HTMLElement> }) => {
    const top = article.getBoundingClientRect().top;
    // Measured now: the notes are read after the article has left the document.
    const spans = blocks.map((_, index) => {
      const parts = [...article.querySelectorAll<HTMLElement>(`:scope > [data-mdz-block="${index}"]`)].map((e) => e.getBoundingClientRect());
      return { top: Math.floor(Math.min(...parts.map((r) => r.top)) - top), bottom: Math.ceil(Math.max(...parts.map((r) => r.bottom)) - top) };
    });
    const span = (index: number) => spans[index];
    type Cause = WideBlock & { block: number; source: Source };
    const wide: Cause[] = [];
    blocks.forEach((block, i) => {
      if (portrait && block.decision.orientation === "landscape") wide.push({ ...span(i), block: i, source: block.decision.source });
    });
    for (const w of fitted.wide) {
      const i = Number(w.element.closest<HTMLElement>("[data-mdz-block]")?.dataset.mdzBlock);
      if (!wide.some((c) => c.block === i)) wide.push({ top: w.top, bottom: w.bottom, block: i, source: "settings" });
    }
    const breaks = [...markers.breaks].map((i) => span(i).top);
    const kept = portrait ? blocks.flatMap((b, i) => (b.decision.orientation === "portrait" ? [span(i)] : [])) : [];
    const overflowingBlocks = new Set([...fitted.overflowing].map((e) => blockOf(e)).filter(Boolean));
    const automatic = (block: Block): Orientation => (portrait && settings === "landscape" && overflowingBlocks.has(block) ? "landscape" : "portrait");

    const summary: string[] = [`Print settings: ${portrait ? SETTINGS_TEXT[settings] : "every page is landscape (Orientation: Landscape)"}.`];
    const marked = blocks.filter((b) => b.marker);
    const count = (list: Block[], o: Orientation, key: "marker" | "local") => list.filter((b) => b[key] === o).length;
    if (marked.length || markers.breaks.size) {
      const parts = [
        count(marked, "landscape", "marker") && `landscape ×${count(marked, "landscape", "marker")}`,
        count(marked, "portrait", "marker") && `portrait ×${count(marked, "portrait", "marker")}`,
        markers.breaks.size && `page break ×${markers.breaks.size}`,
      ].filter(Boolean);
      summary.push(`Markers in the file: ${parts.join(", ")}.`);
    }
    const yours = blocks.filter((b) => b.local);
    if (yours.length) summary.push(`Your exceptions on this computer: ${yours.length} (they win over markers and settings).`);
    for (const b of blocks) {
      const over = b.decision.overrules;
      if (over) summary.push(`Your ${b.decision.orientation} for ${b.label} overrides the ${over.orientation} ${SOURCE_TEXT[over.source]}.`);
      if (!portrait && b.decision.orientation === "portrait") summary.push(`Ignored: portrait for ${b.label} (${SOURCE_TEXT[b.decision.source]}), every page is landscape.`);
    }
    if (markers.unused) summary.push(`${markers.unused} marker${markers.unused > 1 ? "s apply" : " applies"} to nothing (e.g. “end” without “start”).`);
    if (misplaced) summary.push(`${misplaced} marker${misplaced > 1 ? "s are" : " is"} ignored: put markers on a line of their own, between blocks.`);
    if (orphans.length)
      summary.push(`${orphans.length === 1 ? "1 of your exceptions no longer matches" : `${orphans.length} of your exceptions no longer match`} the document (its content changed).`);

    return {
      wide,
      breaks,
      portraitBlocks: kept,
      notes: (pages: MixedPage[]): PageNotes => {
        const onPage = (page: MixedPage) =>
          blocks.filter((_, i) => {
            const s = span(i);
            return s.bottom > page.start + 0.5 && s.top < page.end - 0.5;
          });
        const page = (index: number) => {
          const p = pages[index];
          if (p.landscape) {
            const cause = wide[p.cause ?? -1];
            const block = cause && blocks[cause.block];
            if (!cause || !block) return "landscape";
            const over = block.decision.overrules;
            return `landscape · ${cause.source === "settings" ? "wide table, print settings" : SOURCE_TEXT[cause.source]}${over ? ` (overrides ${SOURCE_TEXT[over.source]})` : ""}`;
          }
          const held = onPage(p).find((b) => portrait && b.decision.orientation === "portrait");
          return held ? `portrait · ${SOURCE_TEXT[held.decision.source]}` : "";
        };
        return {
          page,
          summary,
          orphans,
          target: (index) => {
            const p = pages[index];
            if (!p) return null;
            const here = onPage(p);
            const causeBlock = p.landscape ? blocks[wide[p.cause ?? -1]?.block ?? -1] : undefined;
            // The block that decides the page: what turned it, a block with an exception, a wide one, or the first one starting on it.
            const block =
              causeBlock ??
              here.find((b) => b.decision.orientation) ??
              here.find((b) => overflowingBlocks.has(b)) ??
              here.find((b) => span(blocks.indexOf(b)).top >= p.start - 0.5) ??
              here[0];
            if (!block) return null;
            return {
              anchor: block.anchor,
              label: block.label,
              effective: p.landscape ? "landscape" : "portrait",
              reason: page(index) || "portrait · print settings",
              local: block.local,
              marker: block.marker,
              automatic: automatic(block),
              turnable: portrait,
            };
          },
        };
      },
    };
  };

  return { modeFor, finish };
}
