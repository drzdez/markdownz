import { describe, expect, it } from "vitest";
import type { LocalException } from "../print/orientation";
import { columnsChoice, columnsCut, fitsOnePageTall, isSheet, parseRangeText, prepareSheetsForPaper, prepareSheetsForScreen, rangeText } from "./sheets";

/** A sheet as the xlsx plugin writes it: A–D, rows 1–5, "Title" merged over A1:D1. */
function sheet(attributes: string): HTMLElement {
  const article = document.createElement("article");
  const head = ["A", "B", "C", "D"].map((name, c) => `<th data-c="${c}" style="width:64px;min-width:64px">${name}</th>`).join("");
  const row = (r: number) =>
    `<tr data-r="${r}"><th class="mdz-rh">${r + 1}</th>${[0, 1, 2, 3].map((c) => `<td data-c="${c}"><div style="width:63px">${"ABCD"[c]}${r + 1}</div></td>`).join("")}</tr>`;
  article.innerHTML =
    `<table class="mdz-excel" data-mdz-sheet="Data" data-mdz-key="sheet:Data"${attributes}><thead><tr><th class="mdz-corner"></th>${head}</tr></thead><tbody>` +
    `<tr data-r="0"><th class="mdz-rh">1</th><td data-c="0" data-ce="3" colspan="4"><div style="width:255px">Title</div></td></tr>` +
    [1, 2, 3, 4].map(row).join("") +
    `</tbody></table>`;
  return article;
}

const texts = (rows: Iterable<HTMLTableRowElement>) => [...rows].map((r) => [...r.cells].filter((c) => c.tagName === "TD").map((c) => c.textContent).join(" "));

describe("Excel sheets on paper", () => {
  it("keeps the print area and the title rows", () => {
    const article = sheet(' data-mdz-print-area="2,1,3,2" data-mdz-print-titles="0,0"');
    expect(prepareSheetsForPaper(article, "printArea").count).toBe(1);
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

  /** Your choice for the sheet "Data", as stored in the config. */
  const yours = (choice: Partial<LocalException>): LocalException[] => [{ anchor: { tag: "table", heading: "", hash: "", key: "sheet:Data" }, label: "sheet", ...choice }];

  it("follows your choice for the sheet over the print settings", () => {
    const all = sheet(' data-mdz-print-area="2,1,3,2"');
    prepareSheetsForPaper(all, "printArea", yours({ area: "all" }));
    expect(all.querySelector("table")!.tBodies[0].rows).toHaveLength(5);
    const range = sheet("");
    const { notes } = prepareSheetsForPaper(range, "all", yours({ area: "A4:B5", fit: "page" }));
    expect(texts(range.querySelector("table")!.tBodies[0].rows)).toEqual(["A4 B4", "A5 B5"]);
    expect(fitsOnePageTall(range.querySelector("table")!)).toBe(true);
    expect(notes).toEqual(["Excel sheet “Data”: range A4:B5 of A1:D5 (your choice), on one page (your choice)."]);
  });

  it("shows the same part on screen, with headings and a tag saying it is a part", () => {
    const part = sheet(' data-mdz-print-area="2,1,3,2"');
    const [state] = prepareSheetsForScreen(part, "printArea");
    const table = part.querySelector("table")!;
    expect(state).toMatchObject({ name: "Data", printArea: "B3:C4", whole: "A1:D5", shown: "B3:C4", source: "settings" });
    expect(table.caption!.textContent).toBe("Print area B3:C4 of A1:D5▾");
    expect(state).toMatchObject({ rows: [2, 3], cols: [1, 2] });
    expect(columnsCut(state)).toBe(true);
    // The column slider keeps the rows shown.
    expect(columnsChoice(state, 0, 2)).toBe("A3:C4");
    expect(columnsChoice(state, 0, 3)).toBe("A3:D4");
    // Row numbers stay on screen: they tell where the part is.
    expect([...table.tBodies[0].rows].map((r) => r.cells[0].textContent)).toEqual(["3", "4"]);
    const whole = sheet(' data-mdz-print-area="2,1,3,2"');
    prepareSheetsForScreen(whole, "all");
    expect(whole.querySelector("caption")!.textContent).toBe("Whole sheet A1:D5 · print area B3:C4▾");
    // Without a print area too: a range of your own can still be chosen.
    const plain = sheet("");
    const [full] = prepareSheetsForScreen(plain, "printArea");
    expect(plain.querySelector("caption")!.textContent).toBe("Whole sheet A1:D5▾");
    expect(columnsCut(full)).toBe(false);
    // All columns of the whole sheet: no choice needed.
    expect(columnsChoice(full, 0, 3)).toBeUndefined();
    expect(columnsChoice(full, 1, 3)).toBe("B1:D5");
  });

  it("reads and writes ranges of cells", () => {
    expect(parseRangeText(" k40 : b3 ")).toEqual([2, 1, 39, 10]);
    expect(parseRangeText("$A$1")).toEqual([0, 0, 0, 0]);
    expect(parseRangeText("A0")).toBeNull();
    expect(parseRangeText("B3-K40")).toBeNull();
    expect(rangeText([2, 1, 39, 10])).toBe("B3:K40");
    expect(rangeText([0, 26, 0, 26])).toBe("AA1");
  });
});
