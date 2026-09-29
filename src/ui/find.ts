import { pushLayer, removeLayer, type Layer } from "./overlay";

const SKIP = "svg, script, style, .katex-mathml, mark.mdz-find";

/** In-document search that wraps matches in <mark> elements. */
export class Finder {
  private bar = document.getElementById("findbar")!;
  private input = document.getElementById("find-input") as HTMLInputElement;
  private count = document.getElementById("find-count")!;
  private marks: HTMLElement[] = [];
  private index = -1;
  private layer: Layer = {
    close: () => this.close(),
    onKey: (e) => {
      if (e.key === "Enter" || e.key === "F3") {
        this.step(e.shiftKey ? -1 : 1);
        return true;
      }
      return false;
    },
  };

  constructor(private getRoot: () => HTMLElement | null) {
    this.input.addEventListener("input", () => this.search());
    document.getElementById("find-next")!.addEventListener("click", () => this.step(1));
    document.getElementById("find-prev")!.addEventListener("click", () => this.step(-1));
    document.getElementById("find-close")!.addEventListener("click", () => this.close());
  }

  get isOpen(): boolean {
    return !this.bar.hidden;
  }

  open(): void {
    if (!this.isOpen) {
      this.bar.hidden = false;
      pushLayer(this.layer);
    }
    const selected = window.getSelection()?.toString().trim();
    if (selected && !selected.includes("\n")) this.input.value = selected;
    this.input.focus();
    this.input.select();
    this.search();
  }

  close(): void {
    if (!this.isOpen) return;
    this.clear();
    this.bar.hidden = true;
    removeLayer(this.layer);
    this.getRoot()?.parentElement?.focus({ preventScroll: true });
  }

  /** Re-applies the search after the document was re-rendered or the tab changed. */
  refresh(): void {
    if (this.isOpen) this.search(false);
  }

  step(dir: number): void {
    if (!this.isOpen) return this.open();
    if (!this.marks.length) return;
    this.select((this.index + dir + this.marks.length) % this.marks.length);
  }

  private search(scroll = true): void {
    this.clear();
    const root = this.getRoot();
    const query = this.input.value;
    if (!root || !query) {
      this.count.textContent = "";
      return;
    }
    const needle = query.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);

    for (const node of nodes) {
      const text = node.data.toLowerCase();
      let at = text.indexOf(needle);
      let current = node;
      let offset = 0;
      while (at >= 0) {
        const match = current.splitText(at - offset);
        const rest = match.splitText(query.length);
        const mark = document.createElement("mark");
        mark.className = "mdz-find";
        match.replaceWith(mark);
        mark.append(match);
        this.marks.push(mark);
        current = rest;
        offset = at + query.length;
        at = text.indexOf(needle, offset);
      }
    }
    if (this.marks.length) this.select(this.firstVisible(), scroll);
    else this.count.textContent = "0/0";
  }

  private firstVisible(): number {
    const i = this.marks.findIndex((m) => m.getBoundingClientRect().top >= 0);
    return i < 0 ? 0 : i;
  }

  private select(i: number, scroll = true): void {
    this.marks[this.index]?.classList.remove("current");
    this.index = i;
    const mark = this.marks[i];
    mark.classList.add("current");
    if (scroll) mark.scrollIntoView({ block: "center" });
    this.count.textContent = `${i + 1}/${this.marks.length}`;
  }

  private clear(): void {
    for (const mark of this.marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      mark.replaceWith(...mark.childNodes);
      parent.normalize();
    }
    this.marks = [];
    this.index = -1;
  }
}
