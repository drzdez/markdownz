import type { DocumentView, OutlineItem } from "../formats/types";

/** Choices of the table of contents, kept in the settings. */
export interface TocOptions {
  side: "left" | "right";
  /** How much of the outline is shown, see detailSteps; 0 = everything. */
  detail: number;
  /** Width of the sidebar in CSS px. */
  width: number;
}

export const TOC_WIDTH = 260;
const TOC_MIN = 160;

/** The width of the sidebar within its limits (at most 60 % of the window). */
export function tocWidth(width: number, windowWidth: number): number {
  const max = Math.max(TOC_MIN, Math.round(windowWidth * 0.6));
  return Number.isFinite(width) ? Math.min(max, Math.max(TOC_MIN, Math.round(width))) : TOC_WIDTH;
}

/**
 * The detail steps of an outline, from the main chapters (1) to everything:
 * first the heading levels one by one, then the bullets, then the nested
 * bullets. `step` says from which step on an entry is shown.
 */
export function detailSteps(items: OutlineItem[]): { steps: number; step: (item: OutlineItem) => number } {
  const headings = items.filter((i) => i.kind !== "item");
  const top = headings.length ? Math.min(...headings.map((i) => i.level)) : 1;
  const headingSteps = headings.length ? Math.max(...headings.map((i) => i.level)) - top + 1 : 0;
  const step = (i: OutlineItem) => (i.kind === "item" ? headingSteps + 1 + (i.depth ?? 0) : i.level - top + 1);
  const steps = items.length ? Math.max(...items.map(step)) : 0;
  return { steps, step };
}

/** Table of contents sidebar built from the active document's outline. */
export class Toc {
  private nav = document.getElementById("toc")!;
  private entries: { item: OutlineItem; link: HTMLElement }[] = [];
  options: TocOptions = { side: "left", detail: 0, width: TOC_WIDTH };
  private items: OutlineItem[] = [];
  private empty = "No outline";
  /** Called when the reader changes the side, the detail or the width of the sidebar. */
  onOptionsChange: (options: TocOptions) => void = () => {};
  /** Called when the mark on the edge is clicked: open or close the sidebar. */
  onToggle: () => void = () => {};
  /** The edge of the sidebar: drag it to change the width; its mark opens and closes the sidebar. */
  private edge = document.createElement("div");
  private mark = document.createElement("button");

  constructor() {
    this.edge.id = "toc-edge";
    this.mark.className = "toc-mark";
    this.mark.tabIndex = -1;
    this.edge.append(this.mark);
    this.nav.after(this.edge);
    this.mark.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onToggle();
    });
    this.mark.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.edge.addEventListener("dblclick", (e) => {
      if (e.target !== this.edge || !this.visible) return;
      this.change({ width: TOC_WIDTH });
    });
    this.edge.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.visible) return;
      e.preventDefault();
      const box = this.nav.getBoundingClientRect();
      this.edge.setPointerCapture(e.pointerId);
      this.edge.classList.add("dragging");
      const move = (m: PointerEvent) => {
        const width = this.options.side === "left" ? m.clientX - box.left : box.right - m.clientX;
        this.options = { ...this.options, width: tocWidth(width, window.innerWidth) };
        this.nav.style.width = `${this.options.width}px`;
      };
      const up = () => {
        this.edge.removeEventListener("pointermove", move);
        this.edge.removeEventListener("pointerup", up);
        this.edge.removeEventListener("pointercancel", up);
        this.edge.classList.remove("dragging");
        this.onOptionsChange(this.options);
      };
      this.edge.addEventListener("pointermove", move);
      this.edge.addEventListener("pointerup", up);
      this.edge.addEventListener("pointercancel", up);
    });
    this.place();
  }

  /** Puts the sidebar on its side of the window, at its width, and turns the mark on the edge. */
  place(): void {
    this.nav.parentElement?.classList.toggle("toc-right", this.options.side === "right");
    this.nav.style.width = `${tocWidth(this.options.width, window.innerWidth)}px`;
    const open = this.visible;
    const pointsLeft = open === (this.options.side === "left");
    this.mark.textContent = pointsLeft ? "‹" : "›";
    this.mark.title = open ? "Close the table of contents (Ctrl+B)" : "Open the table of contents (Ctrl+B)";
    this.edge.classList.toggle("closed", !open);
    this.edge.title = open ? "Drag to change the width of the table of contents; double click for the default width" : "";
  }

  private header(steps: number): HTMLElement {
    const head = document.createElement("div");
    head.className = "toc-head";
    const title = Object.assign(document.createElement("span"), { textContent: "Contents" });
    head.append(title);
    if (steps > 1) {
      const shown = this.options.detail > 0 ? Math.min(this.options.detail, steps) : steps;
      const slider = Object.assign(document.createElement("input"), { type: "range", min: "1", max: String(steps), step: "1", value: String(shown) });
      slider.className = "toc-detail";
      slider.title = "Detail of the contents: left main chapters only, right everything including bullets";
      slider.setAttribute("aria-label", "Detail of the contents");
      const set = () => {
        const value = Number(slider.value);
        this.options = { ...this.options, detail: value >= steps ? 0 : value };
        this.renderList();
      };
      slider.addEventListener("input", set);
      slider.addEventListener("change", () => {
        set();
        this.onOptionsChange(this.options);
      });
      head.append(slider);
    }
    const side = Object.assign(document.createElement("button"), {
      textContent: this.options.side === "right" ? "⇤" : "⇥",
      title: this.options.side === "right" ? "Move the contents to the left" : "Move the contents to the right",
    });
    side.addEventListener("click", () => this.change({ side: this.options.side === "right" ? "left" : "right" }));
    head.append(side);
    return head;
  }

  private change(patch: Partial<TocOptions>): void {
    this.options = { ...this.options, ...patch };
    this.place();
    this.build(this.items, this.empty);
    this.onOptionsChange(this.options);
  }

  get visible(): boolean {
    return !this.nav.hidden;
  }

  set visible(on: boolean) {
    this.nav.hidden = !on;
    this.place();
  }

  /** `empty`: hint shown instead of an empty list. */
  build(items: OutlineItem[], empty = "No outline"): void {
    this.items = items;
    this.empty = empty;
    this.nav.replaceChildren(this.header(detailSteps(items).steps));
    this.renderList();
  }

  /** The entries of the outline shown at the chosen detail. */
  private renderList(): void {
    this.nav.querySelectorAll(":scope > a, :scope > p").forEach((e) => e.remove());
    this.entries = [];
    if (!this.items.length) {
      this.nav.append(Object.assign(document.createElement("p"), { className: "mdz-hint", textContent: this.empty }));
      return;
    }
    const { step, steps } = detailSteps(this.items);
    const detail = this.options.detail > 0 ? this.options.detail : steps;
    const shown = this.items.filter((item) => step(item) <= detail);
    const minLevel = Math.min(...shown.map((i) => i.level));
    for (const item of shown) {
      const link = document.createElement("a");
      link.textContent = item.title;
      link.href = "#";
      link.title = item.title;
      link.style.paddingLeft = `${(item.level - minLevel) * 12 + 12}px`;
      if (item.kind === "item") link.classList.add("toc-item");
      link.addEventListener("click", (e) => {
        e.preventDefault();
        item.activate();
      });
      this.nav.append(link);
      this.entries.push({ item, link });
    }
    if (this.lastView) this.sync(this.lastView);
  }

  private lastView: DocumentView | null = null;

  /** Highlights the entry of the section currently being read. */
  sync(view: DocumentView): void {
    this.lastView = view;
    if (!this.visible) return;
    const tracked = this.entries.filter((e) => e.item.position);
    if (!tracked.length) return;
    const here = view.position();
    let active = tracked[0];
    for (const entry of tracked) {
      if (entry.item.position!() <= here) active = entry;
      else break;
    }
    for (const { link } of this.entries) link.classList.toggle("active", link === active.link);
    active.link.scrollIntoView({ block: "nearest" });
  }
}
