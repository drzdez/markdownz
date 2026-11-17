import { describe, expect, it } from "vitest";
import { markdownOutline } from "./outline";

const article = (html: string) => Object.assign(document.createElement("article"), { innerHTML: html });

const HTML = `<h1>Title</h1><p>Intro</p>
<ul><li>First <strong>point</strong><ul><li>Detail<ul><li>Too deep</li></ul></li></ul></li><li>Second</li></ul>
<h2>Chapter</h2><ol><li><p>Step   one</p></li></ol>
<table><tr><td><ul><li>In a table</li></ul></td></tr></table>
<blockquote><ul><li>Quoted</li></ul></blockquote>`;

describe("table of contents of Markdown", () => {
  it("lists the chapters, and the bullets under them on request", () => {
    const a = article(HTML);
    expect(markdownOutline(a, a).map((i) => [i.title, i.level])).toEqual([
      ["Title", 1],
      ["Chapter", 2],
    ]);
    expect(markdownOutline(a, a, { lists: true }).map((i) => [i.title, i.level, i.kind ?? "heading"])).toEqual([
      ["Title", 1, "heading"],
      ["First point", 2, "item"],
      ["Detail", 3, "item"],
      ["Second", 2, "item"],
      ["Chapter", 2, "heading"],
      ["Step one", 3, "item"],
    ]);
  });

  it("shortens long bullets and starts at level 1 before any heading", () => {
    const a = article(`<ul><li>${"word ".repeat(40)}</li></ul>`);
    const [item] = markdownOutline(a, a, { lists: true });
    expect(item.level).toBe(1);
    expect(item.title.length).toBe(120);
    expect(item.title.endsWith("…")).toBe(true);
  });
});
