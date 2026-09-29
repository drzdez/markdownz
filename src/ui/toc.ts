/** Table of contents sidebar built from the headings of the active document. */
export class Toc {
  private nav = document.getElementById("toc")!;
  private links: { heading: HTMLElement; link: HTMLElement }[] = [];

  get visible(): boolean {
    return !this.nav.hidden;
  }

  set visible(on: boolean) {
    this.nav.hidden = !on;
  }

  build(article: HTMLElement | null, scrollTo: (el: HTMLElement) => void): void {
    this.nav.replaceChildren();
    this.links = [];
    const headings = article ? [...article.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")] : [];
    if (!headings.length) {
      this.nav.append(Object.assign(document.createElement("p"), { className: "mdz-hint", textContent: "No headings" }));
      return;
    }
    const minLevel = Math.min(...headings.map((h) => Number(h.tagName[1])));
    for (const heading of headings) {
      const link = document.createElement("a");
      link.textContent = heading.textContent;
      link.href = `#${heading.id}`;
      link.style.paddingLeft = `${(Number(heading.tagName[1]) - minLevel) * 12 + 12}px`;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        scrollTo(heading);
      });
      this.nav.append(link);
      this.links.push({ heading, link });
    }
  }

  /** Highlights the section currently at the top of the viewport. */
  sync(container: HTMLElement): void {
    if (!this.visible || !this.links.length) return;
    const top = container.getBoundingClientRect().top + 16;
    let active = this.links[0];
    for (const entry of this.links) {
      if (entry.heading.getBoundingClientRect().top <= top) active = entry;
      else break;
    }
    for (const { link } of this.links) link.classList.toggle("active", link === active.link);
    active.link.scrollIntoView({ block: "nearest" });
  }
}
