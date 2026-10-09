// Page orientation of a Markdown document on paper: wide content (print
// settings), markers in the file and your exceptions, resolved in that order of
// priority (see print/orientation.ts), with an explanation for every page and
// a description of every marker for the marks shown on screen.

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
  type RuleRef,
  type Source,
} from "../print/orientation";
import type { BlockInfo, MarkInfo, PageNotes } from "./types";
import type { PaperWide } from "./wideObjects";

interface Block {
  element: HTMLElement;
  anchor: BlockAnchor;
  label: string;
  /** Source lines [line, end) of the block, -1 when unknown. */
  line: number;
  end: number;
  local?: Orientation;
  localBreak: boolean;
  marker?: Orientation;
  decision: Decision;
}

const SETTINGS_TEXT: Record<WideTables, string> = {
  landscape: "a wide table turns its page landscape, then shrinks if needed",
  shrink: "wide tables shrink to fit, pages stay portrait",
  none: "wide tables are left as they are (cut off)",
};

function describe(element: HTMLElement): string {
  const row = element.tagName === "TABLE" ? (element as HTMLTableElement).rows[0] : null;
  const text = (row ? [...row.cells].map((c) => c.textContent?.trim()).join(" | ") : element.textContent) ?? "";
  const short = text.replace(/\s+/g, " ").trim();
  const quote = short ? ` “${short.length > 40 ? `${short.slice(0, 40)}…` : short}”` : "";
  const kind: Record<string, string> = { TABLE: "table", PRE: "code block", P: "paragraph", UL: "list", OL: "list", BLOCKQUOTE: "quote", FIGURE: "diagram" };
  return (/^H[1-6]$/.test(element.tagName) ? "heading" : (kind[element.tagName] ?? "block")) + quote;
}

/** Top-level blocks and markers of a rendered article, with their source lines. */
export function readBlocks(article: HTMLElement) {
  const items: Item[] = [];
  const marks: { item: number; value: MarkerValue; moves?: RuleRef; line: number; before: number }[] = [];
  const elements: { element: HTMLElement; anchor: BlockAnchor; line: number; end: number }[] = [];
  let heading = "";
  let source: { line: number; end: number } | null = null;
  for (const child of [...article.children] as HTMLElement[]) {
    if (child.classList.contains("mdz-src")) {
      source = { line: Number(child.dataset.line), end: Number(child.dataset.end) };
      continue;
    }
    if (child.classList.contains("mdz-mark")) {
      const [tag, hash] = (child.dataset.moves ?? "").split(" ");
      const moves = tag && hash ? { tag, hash } : undefined;
      marks.push({ item: items.length, value: child.dataset.mdz as MarkerValue, moves, line: child.dataset.line ? Number(child.dataset.line) : -1, before: elements.length });
      items.push({ mark: child.dataset.mdz as MarkerValue, moves });
      continue;
    }
    child.dataset.mdzBlock = String(elements.length);
    elements.push({ element: child, anchor: makeAnchor(child.tagName, heading, child.textContent ?? ""), line: source?.line ?? -1, end: source?.end ?? -1 });
    if (/^H[1-6]$/.test(child.tagName)) heading = child.textContent ?? "";
    source = null;
    items.push({ block: true });
  }
  return { items, marks, elements };
}

/**
 * Reads the blocks of a rendered article (marking each with data-mdz-block),
 * the markers between them and your exceptions, and decides per block.
 * `portrait`: the pages are portrait, so blocks can be turned to landscape.
 */
export function planOrientation(article: HTMLElement, locals: LocalException[], settings: WideTables, portrait: boolean) {
  const { items, marks, elements } = readBlocks(article);
  const markers = resolveMarkers(items);
  // Markers inside paragraphs or lists cannot be placed between blocks.
  const misplaced = article.querySelectorAll(":scope * .mdz-mark").length;
  const matched = new Set<LocalException>();
  const blocks: Block[] = elements.map(({ element, anchor, line, end }, i) => {
    const local = locals.find((l) => l.orientation && !matched.has(l) && sameAnchor(l.anchor, anchor));
    if (local) matched.add(local);
    const localBreak = locals.find((l) => l.pageBreak && !matched.has(l) && sameAnchor(l.anchor, anchor));
    if (localBreak) matched.add(localBreak);
    const marker = markers.orientation[i];
    return { element, anchor, label: describe(element), line, end, local: local?.orientation, localBreak: !!localBreak, marker, decision: decide(local?.orientation, marker) };
  });
  const orphans = locals.filter((l) => !matched.has(l));
  const blockOf = (element: Element): Block | undefined => blocks[Number(element.closest<HTMLElement>("[data-mdz-block]")?.dataset.mdzBlock)];
  const ruleBlock = (ref: RuleRef) => blocks.findIndex((b) => b.anchor.tag === ref.tag && b.anchor.hash === ref.hash);

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
    const boundary = (before: number) => (before < blocks.length ? span(before).top : (spans.at(-1)?.bottom ?? 0));
    const overflowingBlocks = new Set([...fitted.overflowing].map((e) => blockOf(e)).filter(Boolean));
    /** The print settings turn this block's pages (it is wide and nothing overrules it). */
    const byRule = (block: Block) => portrait && settings === "landscape" && overflowingBlocks.has(block);

    type Cause = WideBlock & { block: number; source: Source | "shift" };
    const wide: Cause[] = [];
    blocks.forEach((block, i) => {
      if (portrait && block.decision.orientation === "landscape") wide.push({ ...span(i), block: i, source: block.decision.source });
    });

    // Moved rules: the turn of a wide block starts earlier or ends later, at a marker.
    const markInfo: MarkInfo[] = marks.map((m) => ({ value: m.value, line: m.line, before: m.before, status: markers.unusedItems.has(m.item) ? "unused" : "ok", note: "" }));
    const moved = new Map<number, { from: number; to: number }>();
    markers.shifts.forEach((shift) => {
      const info = markInfo[marks.findIndex((m) => m.item === shift.item)];
      const rule = ruleBlock(shift.moves);
      info.moves = { tag: shift.moves.tag, hash: shift.moves.hash, block: rule };
      const fail = (status: MarkInfo["status"], note: string) => Object.assign(info, { status, note });
      if (rule < 0) return fail("broken", `the ${shift.moves.tag} it moves is not in the document any more (its content changed)`);
      if (!portrait || settings !== "landscape") return fail("ignored", "the print settings do not turn pages for wide tables");
      if (!byRule(blocks[rule])) return fail("ignored", `${blocks[rule].label} is not wide on paper, so no page is turned for it`);
      const start = shift.value === "landscape start";
      if (start ? shift.before > rule : shift.before <= rule) return fail("broken", `must be ${start ? "above" : "below"} ${blocks[rule].label}`);
      const range = moved.get(rule) ?? { from: rule, to: rule };
      if (start) range.from = Math.min(range.from, shift.before);
      else range.to = Math.max(range.to, shift.before - 1);
      moved.set(rule, range);
      info.note = `moves the turn of ${blocks[rule].label} ${start ? "up" : "down"}`;
    });
    for (const [rule, range] of moved) {
      const first = span(range.from);
      const last = span(range.to);
      wide.push({ top: Math.min(first.top, span(rule).top), bottom: Math.max(last.bottom, span(rule).bottom), block: rule, source: "shift" });
    }

    // Every wide object turns its pages, including each part of a table split by columns
    // (the parts share the block); a block turned otherwise already covers all its parts.
    const turned = new Set(wide.map((c) => c.block));
    for (const w of fitted.wide) {
      const i = Number(w.element.closest<HTMLElement>("[data-mdz-block]")?.dataset.mdzBlock);
      if (!turned.has(i)) wide.push({ top: w.top, bottom: w.bottom, block: i, source: "settings" });
    }
    const markerBreaks = new Set([...markers.breaks].map((i) => boundary(i)));
    const yourBreaks = new Set(blocks.flatMap((b, i) => (b.localBreak && i > 0 ? [boundary(i)] : [])));
    const breaks = [...new Set([...markerBreaks, ...yourBreaks])];
    const kept = portrait ? blocks.flatMap((b, i) => (b.decision.orientation === "portrait" ? [span(i)] : [])) : [];
    const automatic = (block: Block): Orientation => (byRule(block) ? "landscape" : "portrait");

    markInfo.forEach((info, i) => {
      if (info.status === "unused") info.note = "applies to nothing (e.g. “end” without “start”, or at the end)";
      else if (!info.moves && !info.note) {
        const block = blocks[marks[i].before];
        info.note = info.value === "page break" ? "starts a new page" : block ? `for ${block.label}` : "";
        if (block?.decision.overrules) info.note += `; your exception (${block.decision.orientation}) overrides it`;
        if (!portrait && info.value.startsWith("portrait")) Object.assign(info, { status: "ignored", note: "every page is landscape (Orientation: Landscape)" });
      }
    });

    const summary: string[] = [`Print settings: ${portrait ? SETTINGS_TEXT[settings] : "every page is landscape (Orientation: Landscape)"}.`];
    const marked = blocks.filter((b) => b.marker);
    const count = (list: Block[], o: Orientation, key: "marker" | "local") => list.filter((b) => b[key] === o).length;
    if (marked.length || markers.breaks.size || markers.shifts.length) {
      const parts = [
        count(marked, "landscape", "marker") && `landscape ×${count(marked, "landscape", "marker")}`,
        count(marked, "portrait", "marker") && `portrait ×${count(marked, "portrait", "marker")}`,
        markers.breaks.size && `page break ×${markers.breaks.size}`,
        markers.shifts.length && `moved turns ×${markers.shifts.length}`,
      ].filter(Boolean);
      summary.push(`Markers in the file: ${parts.join(", ")}.`);
    }
    const yours = blocks.filter((b) => b.local);
    if (yours.length) summary.push(`Your exceptions on this computer: ${yours.length} (they win over markers and settings).`);
    const yourBreakCount = blocks.filter((b) => b.localBreak).length;
    if (yourBreakCount) summary.push(`Your page breaks on this computer: ${yourBreakCount}.`);
    for (const b of blocks) {
      const over = b.decision.overrules;
      if (over) summary.push(`Your ${b.decision.orientation} for ${b.label} overrides the ${over.orientation} ${SOURCE_TEXT[over.source]}.`);
      if (!portrait && b.decision.orientation === "portrait") summary.push(`Ignored: portrait for ${b.label} (${SOURCE_TEXT[b.decision.source]}), every page is landscape.`);
    }
    for (const m of markInfo) if (m.moves && m.status !== "ok") summary.push(`Moved turn ${m.status === "broken" ? "not valid" : "ignored"}: ${m.note}.`);
    if (markers.unused) summary.push(`${markers.unused} marker${markers.unused > 1 ? "s apply" : " applies"} to nothing (e.g. “end” without “start”).`);
    if (misplaced) summary.push(`${misplaced} marker${misplaced > 1 ? "s are" : " is"} ignored: put markers on a line of their own, between blocks.`);
    if (orphans.length)
      summary.push(`${orphans.length === 1 ? "1 of your exceptions no longer matches" : `${orphans.length} of your exceptions no longer match`} the document (its content changed).`);

    const blockInfo: BlockInfo[] = blocks.map((b, i) => ({
      line: b.line,
      end: b.end,
      label: b.label,
      anchor: b.anchor,
      rule: byRule(b),
      moved: moved.has(i) ? moved.get(i) : undefined,
      local: b.local,
      localBreak: b.localBreak,
      marker: b.marker,
      decided: b.decision.orientation,
      source: b.decision.source,
    }));

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
            if (cause.source === "shift") return "landscape · moved turn (marker in the file)";
            const over = block.decision.overrules;
            return `landscape · ${cause.source === "settings" ? "wide content, print settings" : SOURCE_TEXT[cause.source]}${over ? ` (overrides ${SOURCE_TEXT[over.source]})` : ""}`;
          }
          const held = onPage(p).find((b) => portrait && b.decision.orientation === "portrait");
          return held ? `portrait · ${SOURCE_TEXT[held.decision.source]}` : "";
        };
        return {
          page,
          summary,
          orphans,
          blocks: blockInfo,
          marks: markInfo,
          turnable: portrait,
          pageStarts: pages.slice(1).map((p, k) => {
            const i = spans.findIndex((s) => s.bottom > p.start + 0.5);
            const s = spans[i];
            const fraction = s && p.start > s.top + 0.5 ? (p.start - s.top) / (s.bottom - s.top) : 0;
            const near = (set: Set<number>) => [...set].some((b) => Math.abs(b - p.start) < 2);
            const cause = near(markerBreaks) ? "marker" : near(yourBreaks) ? "yours" : p.landscape !== pages[k].landscape ? "turn" : "auto";
            return { page: k + 2, block: Math.max(0, i), fraction, cause, landscape: p.landscape };
          }),
          blockTarget: (index, pageIndex) => {
            const block = blocks[index];
            const p = pages[pageIndex];
            if (!block || !p) return null;
            return {
              anchor: block.anchor,
              line: block.line,
              label: block.label,
              effective: p.landscape ? "landscape" : "portrait",
              reason: page(pageIndex) || "portrait · print settings",
              local: block.local,
              marker: block.marker,
              localBreak: block.localBreak,
              automatic: automatic(block),
              turnable: portrait,
            };
          },
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
              line: block.line,
              label: block.label,
              effective: p.landscape ? "landscape" : "portrait",
              reason: page(index) || "portrait · print settings",
              local: block.local,
              marker: block.marker,
              localBreak: block.localBreak,
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
