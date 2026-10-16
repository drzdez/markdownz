import { describe, expect, it } from "vitest";
import { fitsOnePageTall, isSheet, prepareSheetsForPaper } from "./sheets";

/** A sheet as the xlsx plugin writes it: A–D, rows 1–5, "Title" merged over A1:D1. */
function sheet(attributes: string): HTMLElement {
  const article = document.createElement("article");
  const head = ["A", "B", "C", "D"].map((name, c) => `<th data-c="${c}" style="width:64px;min-width:64px">${name}</th>`).join("");
  const row = (r: number) =>
    `<tr data-r="${r}"><th class="mdz-rh">${r + 1}</th>${[0, 1, 2, 3].map((c) => `<td data-c="${c}"><div style="width:63px">${"ABCD"[c]}${r + 1}</div></td>`).join("")}</tr>`;
  article.innerHTML =
    `<table class="mdz-excel" data-mdz-sheet="Data"${attributes}><thead><tr><th class="mdz-corner"></th>${head}</tr></thead><tbody>` +
    `<tr data-r="0"><th class="mdz-rh">1</th><td data-c="0" data-ce="3" colspan="4"><div style="width:255px">Title</div></td></tr>` +
    [1, 2, 3, 4].map(row).join("") +
    `</tbody></table>`;
  return article;
}

const texts = (rows: Iterable<HTMLTableRowElement>) => [...rows].map((r) => [...r.cells].filter((c) => c.tagName === "TD").map((c) => c.textContent).join(" "));

describe("Excel sheets on paper", () => {
  it("keeps the print area and the title rows", () => {
    const article = sheet(' data-mdz-print-area="2,1,3,2" data-mdz-print-titles="0,0"');
    expect(prepareSheetsForPaper(article, "printArea")).toBe(1);
    const table = article.querySelector("table")!;
    // The title row is outside the area but repeated on every page: it moves into the header.
    expect(texts(table.tHead!.rows)).toEqual(["", "Title"]);
    expect(texts(table.tBodies[0].rows)).toEqual(["B3 C3", "B4 C4"]);
    // The merged title keeps only the columns of the area, with their width.
    const title = table.tHead!.rows[1].cells[1] as HTMLTableCellElement;
    expect(title.colSpan).toBe(2);
    expect(title.querySelector("div")!.style.width).toBe("127px");
    // Column headings of the area only.
    expect([...table.tHead!.rows[0].cells].map((c) => c.textContent)).toEqual(["", "B", "C"]);
  });

  it("prints the whole sheet when asked, or when there is no print area", () => {
    for (const [attributes, mode] of [[' data-mdz-print-area="2,1,3,2"', "all"], ["", "printArea"]] as const) {
      const article = sheet(attributes);
      prepareSheetsForPaper(article, mode);
      expect(texts(article.querySelector("table")!.tBodies[0].rows)).toEqual(["Title", "A2 B2 C2 D2", "A3 B3 C3 D3", "A4 B4 C4 D4", "A5 B5 C5 D5"]);
    }
  });

  it("leaves out headings and gridlines unless the sheet prints them", () => {
    const plain = sheet("");
    prepareSheetsForPaper(plain, "printArea");
    expect([...plain.querySelector("table")!.classList]).toEqual(["mdz-excel", "mdz-print-noheadings", "mdz-nogrid"]);
    const printed = sheet(" data-mdz-print-headings data-mdz-print-grid");
    prepareSheetsForPaper(printed, "printArea");
    expect([...printed.querySelector("table")!.classList]).toEqual(["mdz-excel"]);
  });

  it("knows sheets and their fit to one page tall", () => {
    const table = sheet(' data-mdz-print-fit="1,1"').querySelector("table")!;
    expect(isSheet(table)).toBe(true);
    expect(fitsOnePageTall(table)).toBe(true);
    expect(fitsOnePageTall(sheet(' data-mdz-print-fit="1,0"').querySelector("table")!)).toBe(false);
    expect(isSheet(document.createElement("table"))).toBe(false);
  });
});
