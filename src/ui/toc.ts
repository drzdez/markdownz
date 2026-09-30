import type { DocumentView, OutlineItem } from "../formats/types";

/** Table of contents sidebar built from the active document's outline. */
export class Toc {
  private nav = document.getElementById("toc")!;
  private entries: { item: OutlineItem; link: HTMLElement }[] = [];

  get visible(): boolean {
    return !this.nav.hidden;
  }

  set visible(on: boolean) {
    this.nav.hidden = !on;
  }

  build(items: OutlineItem[]): void {
    this.nav.replaceChildren();
    this.entries = [];
    if (!items.length) {
      this.nav.append(Object.assign(document.createElement("p"), { className: "mdz-hint", textContent: "No outline" }));
      return;
    }
    const minLevel = Math.min(...items.map((i) => i.level));
    for (const item of items) {
      const link = document.createElement("a");
      link.textContent = item.title;
      link.href = "#";
      link.title = item.title;
      link.style.paddingLeft = `${(item.level - minLevel) * 12 + 12}px`;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        item.activate();
      });
      this.nav.append(link);
      this.entries.push({ item, link });
    }
  }

  /** Highlights the entry of the section currently being read. */
  sync(view: DocumentView): void {
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
