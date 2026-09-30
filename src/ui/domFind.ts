import type { FindProvider } from "../formats/types";

const SKIP = "svg, script, style, .katex-mathml, mark.mdz-find";

/** Find provider for HTML documents: wraps matches in <mark> elements. */
export class DomFindProvider implements FindProvider {
  onResult?: FindProvider["onResult"];
  private marks: HTMLElement[] = [];
  private index = -1;
  private query = "";

  constructor(private root: () => HTMLElement | null) {}

  find(query: string, direction: 1 | -1, again: boolean): void {
    if (!again || query !== this.query || !this.marks.length) {
      this.search(query);
    } else {
      this.select((this.index + direction + this.marks.length) % this.marks.length);
    }
  }

  clear(): void {
    for (const mark of this.marks) {
      const parent = mark.parentNode;
      if (!parent) continue;
      mark.replaceWith(...mark.childNodes);
      parent.normalize();
    }
    this.marks = [];
    this.index = -1;
  }

  private search(query: string): void {
    this.clear();
    this.query = query;
    const root = this.root();
    if (!root || !query) return this.onResult?.({ index: -1, count: 0 });

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
    if (!this.marks.length) return this.onResult?.({ index: -1, count: 0 });
    const firstVisible = this.marks.findIndex((m) => m.getBoundingClientRect().top >= 0);
    this.select(firstVisible < 0 ? 0 : firstVisible);
  }

  private select(i: number): void {
    this.marks[this.index]?.classList.remove("current");
    this.index = i;
    const mark = this.marks[i];
    mark.classList.add("current");
    mark.scrollIntoView({ block: "center" });
    this.onResult?.({ index: i, count: this.marks.length });
  }
}
