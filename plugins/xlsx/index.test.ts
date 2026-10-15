import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { columnName, xlsxToMarkdown } from "./index";
import { SHORT_DATE, formatNumber, general, serialToDate, setLocaleForTests } from "./numfmt";
import { readWorkbook } from "./workbook";

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A small workbook as Excel writes it: a title merged over A1:C1, a euro price, a red total, a hidden sheet. */
function workbook(): Uint8Array {
  return zipSync({
    "_rels/.rels": strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<workbook ${NS}><sheets><sheet name="TCO" sheetId="1" r:id="rId1"/><sheet name="Secret" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId4" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId5" Type="${REL}/theme" Target="theme/theme1.xml"/></Relationships>`,
    ),
    "xl/theme/theme1.xml": strToU8(
      `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme></a:themeElements></a:theme>`,
    ),
    "xl/styles.xml": strToU8(
      `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0\\ &quot;€&quot;"/></numFmts>` +
        `<fonts count="3"><font><sz val="11"/><color theme="1"/><name val="Calibri"/></font><font><b/><sz val="14"/><color theme="0"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFF0000"/><name val="Calibri"/></font></fonts>` +
        `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor theme="4" tint="-0.249977111117893"/></patternFill></fill></fills>` +
        `<borders count="2"><border><left/><right/><top/><bottom/></border><border><left/><right/><top/><bottom style="thin"><color indexed="64"/></bottom></border></borders>` +
        `<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0"><alignment horizontal="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1"/><xf numFmtId="164" fontId="2" fillId="0" borderId="0"/></cellXfs></styleSheet>`,
    ),
    "xl/sharedStrings.xml": strToU8(`<sst ${NS}><si><t>TCO &lt;2026&gt;</t></si><si><t>Server</t></si><si><r><t>Total </t></r><r><rPr><b/></rPr><t>per year</t></r></si></sst>`),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet ${NS}><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="20" customWidth="1"/><col min="2" max="2" width="5" hidden="1"/></cols><sheetData>` +
        `<row r="1" ht="24" customHeight="1"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" s="1"/><c r="C1" s="1"/></row>` +
        `<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>7</v></c><c r="C2" s="2"><v>5500</v></c></row>` +
        `<row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3" s="3"><f>C2*2</f><v>11000</v></c></row>` +
        `<row r="4"><c r="A4" t="b"><v>1</v></c><c r="C4" t="e"><v>#DIV/0!</v></c></row>` +
        `</sheetData><mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells></worksheet>`,
    ),
    "xl/worksheets/sheet2.xml": strToU8(`<worksheet ${NS}><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>`),
  });
}

// Czech Windows, as the Excel results below were taken from.
beforeAll(() => setLocaleForTests(",", " ", "cs", "."));

describe("Excel plugin", () => {
  it("names columns like Excel", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });

  it("formats numbers like Excel", () => {
    const f = (v: number, code: string) => formatNumber(v, code).text;
    expect(f(1000000, "General")).toBe("1000000");
    expect(general(1 / 3)).toBe("0,333333333");
    expect(general(123456789012)).toBe("1,23457E+11");
    expect(f(5500, '#,##0\\ "€"')).toBe("5 500 €");
    expect(f(5500, "#,##0.00\\ [$€-405]")).toBe("5 500,00 €");
    expect(f(25, "#,##0.00")).toBe("25,00");
    expect(f(0.256, "0.0%")).toBe("25,6%");
    expect(f(-1234.5, "#,##0.00;[Red]-#,##0.00")).toBe("-1 234,50");
    expect(formatNumber(-1234.5, "#,##0.00;[Red]-#,##0.00").color).toBe("#ff0000");
    expect(f(-5, "0")).toBe("-5");
    expect(f(0, '#,##0;-#,##0;"-"')).toBe("-");
    expect(f(1234567, '#,##0,"k"')).toBe("1 235k");
    expect(f(12345, "0.00E+00")).toBe("1,23E+04");
    expect(f(1.5, "# ?/?")).toBe("1 1/2");
    expect(f(0.123, "0.###")).toBe("0,123");
    expect(f(3, "0.0#")).toBe("3,0");
    // Checked against Excel's own text of the cells.
    expect(f(1234.5678, "000-000")).toBe("001-235");
    expect(f(123456789, "000-000")).toBe("123456-789");
    expect(f(1234.5678, "?/8")).toBe("9877/8");
    expect(f(0.5, "# ??/??")).toBe("  1/2 ");
    expect(f(0, "# ?/?")).toBe("0    ");
    const accounting = '_-* #,##0 "€"_-;-* #,##0 "€"_-;_-* "-" "€"_-;_-@_-';
    expect(formatNumber(-1234.5678, accounting)).toEqual({ text: "-1 235 € ", fill: 1 });
    expect(formatNumber(0, accounting)).toEqual({ text: " - € ", fill: 1 });
  });

  it("formats dates and times like Excel", () => {
    expect(serialToDate(45580).toISOString().slice(0, 10)).toBe("2024-10-15");
    expect(serialToDate(1).toISOString().slice(0, 10)).toBe("1900-01-01");
    const f = (v: number, code: string) => formatNumber(v, code).text;
    expect(f(45580, "d.m.yyyy")).toBe("15.10.2024");
    expect(f(45580, "yyyy-mm-dd")).toBe("2024-10-15");
    expect(f(45580.75, "hh:mm")).toBe("18:00");
    expect(f(45580.75, "h:mm AM/PM")).toBe("6:00 odp.");
    expect(f(1.5, "[h]:mm:ss")).toBe("36:00:00");
    // "/" is the system's date separator.
    expect(f(45580.5, "dd/mm/yy hh:mm:ss")).toBe("15.10.24 12:00:00");
    // Checked against Excel: whole seconds rounded, day 0, Excel's 1900 weekdays, no dates out of range.
    expect(f(1234.5678, "[h]:mm:ss")).toBe("29629:37:38");
    expect(f(0, "d.m.yyyy")).toBe("0.1.1900");
    expect(f(1.5, "dddd d. mmmm")).toBe("neděle 1. leden");
    expect(f(45580.75, "mmmm yyyy")).toBe("říjen 2024");
    expect(f(-1, "d.m.yyyy")).toBe("########");
    expect(f(45580, SHORT_DATE)).toBe("15.10.2024");
  });

  it("reads values, styles, theme colours and merges", () => {
    const book = readWorkbook(workbook());
    expect(book.sheets.map((s) => s.name)).toEqual(["TCO"]);
    const sheet = book.sheets[0];
    expect(sheet.merges).toEqual([{ row: 0, col: 0, rows: 1, cols: 3 }]);
    expect(sheet.colWidths.get(0)).toBe(140);
    expect(sheet.hiddenCols.has(1)).toBe(true);
    expect(sheet.rowHeights.get(0)).toBe(32);
    const title = book.styles[sheet.rows.get(0)!.get(0)!.style];
    expect(title.font).toMatchObject({ bold: true, size: 14, color: "#ffffff" });
    expect(title.fill).toBe("#2f5597"); // accent 1, 25 % darker
    expect(book.styles[2].bottom).toBe("1px solid #000000");
    expect(sheet.rows.get(2)!.get(2)!.value).toBe(11000);
    expect(sheet.rows.get(2)!.get(0)!.runs?.[1]).toEqual({ text: "per year", font: { bold: true } });
    expect(sheet.lastRow).toBe(3);
    expect(sheet.lastCol).toBe(2);
  });

  it("shows the sheet as Excel does", async () => {
    const md = await xlsxToMarkdown(workbook());
    expect(md).toContain("## TCO");
    expect(md).not.toContain("Secret");
    // Hidden column B is left out, so the title spans A and C.
    expect(md).toMatch(/<th style="width:140px;min-width:140px">A<\/th><th style="width:64px;min-width:64px">C<\/th><\/tr>/);
    expect(md).toContain('<td colspan="2" style="background:#2f5597">');
    expect(md).toContain("TCO &lt;2026&gt;");
    expect(md).toContain("5 500 €");
    expect(md).toMatch(/font-weight:bold;color:#ff0000[^>]*>11 000 €/);
    expect(md).toContain('Total <span style="font-weight:bold">per year</span>');
    expect(md).toContain(">TRUE<");
    expect(md).toContain(">#DIV/0!<");
    expect(md).toContain('<tr style="height:32px">');
    // The bottom border of C2 is also the top border of C3.
    expect(md).toMatch(/<td style="border-top:1px solid #000000"><div[^>]*>11 000 €/);
  });
});
