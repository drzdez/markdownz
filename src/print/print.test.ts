import { describe, expect, it } from "vitest";
import { dominantOrientation, flipEdge, impose, orientSides, parseRange, passes, placePage, preferredOrientation, sheetCount, sheetGeometry, slotSize, type Side } from "./imposition";
import { dropBlankPages, groupColumns, paginate, paginateMixed } from "./paginate";
import { decide, makeAnchor, markerComment, markersToAnchors, parseMarker, parseMarkerText, pruneExceptions, resolveMarkers, type MarkerValue } from "./orientation";
import { insertLine, isMarkerLine, moveLine, onlyMarkersChanged, removeLine, replaceLine } from "./markerEdit";

describe("page ranges", () => {
  it("parses ranges into zero-based indexes", () => {
    expect(parseRange("", 3)).toEqual([0, 1, 2]);
    expect(parseRange("1-3, 5", 10)).toEqual([0, 1, 2, 4]);
    expect(parseRange("8-", 10)).toEqual([7, 8, 9]);
    expect(parseRange("-2", 10)).toEqual([0, 1]);
    expect(parseRange("2 4", 10)).toEqual([1, 3]);
    expect(parseRange("9-20", 10)).toEqual([8, 9]);
  });

  it("rejects invalid ranges", () => {
    expect(parseRange("a", 5)).toBeNull();
    expect(parseRange("3-1", 5)).toBeNull();
    expect(parseRange("0", 5)).toBeNull();
    expect(parseRange("-", 5)).toBeNull();
  });
});

describe("imposition", () => {
  const pages = (n: number) => [...Array(n).keys()];

  it("puts pages side by side", () => {
    expect(impose(pages(5), "2").map((s) => s.slots)).toEqual([[0, 1], [2, 3], [4, null]]);
    expect(impose(pages(5), "4").map((s) => s.slots)).toEqual([[0, 1, 2, 3], [4, null, null, null]]);
    expect(impose(pages(2), "1").map((s) => s.slots)).toEqual([[0], [1]]);
  });

  it("orders a booklet for folding", () => {
    // 8 pages: sheet 1 = front 8|1, back 2|7; sheet 2 = front 6|3, back 4|5 (1-based).
    expect(impose(pages(8), "booklet").map((s) => s.slots)).toEqual([[7, 0], [1, 6], [5, 2], [3, 4]]);
    // 5 pages are padded to 8 with blanks.
    expect(impose(pages(5), "booklet").map((s) => s.slots)).toEqual([[null, 0], [1, null], [null, 2], [3, 4]]);
  });

  it("keeps the selected page subset", () => {
    expect(impose([2, 4, 6], "2").map((s) => s.slots)).toEqual([[2, 4], [6, null]]);
  });

  it("splits manual duplex into front and back passes", () => {
    const sides = impose(pages(3), "1");
    const [fronts, backs] = passes(sides, "manual", false);
    expect(fronts.map((s) => s.slots)).toEqual([[0], [2]]);
    expect(backs.map((s) => s.slots)).toEqual([[1], [null]]);
    expect(passes(sides, "manual", true)[1].map((s) => s.slots)).toEqual([[null], [1]]);
    expect(passes(sides, "long", false)).toEqual([sides]);
  });

  it("describes sheets", () => {
    expect(sheetGeometry("2", "a4", "landscape")).toEqual({ orientation: "landscape", width: 297, height: 210, cols: 2, rows: 1 });
    expect(sheetGeometry("2", "a4", "portrait")).toEqual({ orientation: "portrait", width: 210, height: 297, cols: 1, rows: 2 });
    expect(sheetGeometry("4", "a4", "portrait")).toEqual({ orientation: "portrait", width: 210, height: 297, cols: 2, rows: 2 });
    expect(sheetGeometry("1", "letter", "landscape")).toMatchObject({ width: 279.4, height: 215.9 });
    expect(flipEdge("landscape")).toBe("short");
    expect(flipEdge("portrait")).toBe("long");
    expect(sheetCount(5, "long")).toBe(3);
    expect(sheetCount(5, "none")).toBe(5);
  });
});

describe("pagination", () => {
  it("breaks at the last candidate that fits", () => {
    expect(paginate([300, 600, 900, 1200], 1500, 1000)).toEqual([[0, 900], [900, 1500]]);
  });

  it("does not break right after a heading", () => {
    expect(paginate([500, 900, 950], 1500, 1000, new Set([950]))).toEqual([[0, 900], [900, 1500]]);
  });

  it("cuts long content without candidates at full height", () => {
    expect(paginate([], 2500, 1000)).toEqual([[0, 1000], [1000, 2000], [2000, 2500]]);
  });

  it("ignores candidates that would leave a nearly empty page", () => {
    expect(paginate([100, 2000], 2500, 1000)).toEqual([[0, 1000], [1000, 2000], [2000, 2500]]);
  });
});

describe("mixed pagination", () => {
  // Portrait pages hold 1000 px, landscape pages 700 px.
  const rows = (from: number, to: number, step = 50) => Array.from({ length: (to - from) / step }, (_, i) => from + (i + 1) * step);

  it("keeps portrait pages without wide blocks", () => {
    expect(paginateMixed(rows(0, 2000), 2000, 1000, 700, [])).toEqual([
      { start: 0, end: 1000, landscape: false },
      { start: 1000, end: 2000, landscape: false },
    ]);
  });

  it("puts text above a wide block on the same landscape page", () => {
    // The table starts at 300, within the first 700 px: page 1 is landscape and continues into the table.
    const pages = paginateMixed(rows(0, 2000), 2000, 1000, 700, [{ top: 300, bottom: 1200 }]);
    expect(pages[0]).toEqual({ start: 0, end: 700, landscape: true, cause: 0 });
    expect(pages[1]).toEqual({ start: 700, end: 1400, landscape: true, cause: 0 });
    expect(pages[2]).toEqual({ start: 1400, end: 2000, landscape: false });
  });

  it("repeats table headers on pages starting inside the table", () => {
    // Table 200-2600 with a 50 px header (200-250); rows every 50 px.
    const pages = paginateMixed(rows(0, 3000), 3000, 1000, 700, [], new Set([250]), [{ top: 200, bottom: 250, end: 2600 }]);
    expect(pages[0]).toEqual({ start: 0, end: 1000, landscape: false });
    // The header takes 50 px, so the second page holds 950 px of the table.
    expect(pages[1]).toEqual({ start: 1000, end: 1950, landscape: false, header: { top: 200, bottom: 250 } });
    expect(pages[2]).toEqual({ start: 1950, end: 2900, landscape: false, header: { top: 200, bottom: 250 } });
    expect(pages[3]).toEqual({ start: 2900, end: 3000, landscape: false });
  });

  it("moves a wide block starting low on a portrait page to the next page", () => {
    const pages = paginateMixed(rows(0, 2000), 2000, 1000, 700, [{ top: 850, bottom: 1300 }]);
    expect(pages[0]).toEqual({ start: 0, end: 850, landscape: false });
    expect(pages[1]).toEqual({ start: 850, end: 1550, landscape: true, cause: 0 });
  });

  it("ends a landscape page before a block that must stay portrait", () => {
    // Wide block 100-400 turns page 1; the block at 500-900 must be portrait.
    const pages = paginateMixed(rows(0, 2000), 2000, 1000, 700, [{ top: 100, bottom: 400 }], new Set(), [], [], [{ top: 500, bottom: 900 }]);
    expect(pages[0]).toEqual({ start: 0, end: 500, landscape: true, cause: 0 });
    expect(pages[1]).toEqual({ start: 500, end: 1500, landscape: false });
  });

  it("moves a diagram that would be cut to the next page", () => {
    // Diagram 800-1300 (500 px high) would cross the end of page 1 at 1000.
    const pages = paginateMixed(rows(0, 2000), 2000, 1000, 700, [], new Set(), [], [], [], [{ top: 800, bottom: 1300 }]);
    expect(pages[0]).toEqual({ start: 0, end: 800, landscape: false });
    expect(pages[1]).toEqual({ start: 800, end: 1800, landscape: false });
  });

  it("keeps a page portrait when a tall diagram comes before the wide block", () => {
    // Diagram 300-950 does not fit a 700 px landscape page; the wide block starts after it.
    const pages = paginateMixed(rows(0, 2000), 2000, 1000, 700, [{ top: 1000, bottom: 1200 }], new Set(), [], [], [], [{ top: 300, bottom: 950 }]);
    expect(pages[0]).toEqual({ start: 0, end: 1000, landscape: false });
    expect(pages[1]).toEqual({ start: 1000, end: 1700, landscape: true, cause: 0 });
  });

  it("keeps a page portrait when a page break comes before the wide block", () => {
    const pages = paginateMixed(rows(0, 2000), 2000, 1000, 700, [{ top: 500, bottom: 900 }], new Set(), [], [400]);
    expect(pages[0]).toEqual({ start: 0, end: 400, landscape: false });
    expect(pages[1]).toEqual({ start: 400, end: 1100, landscape: true, cause: 0 });
  });

  it("does not leave a blank page before a wide block that follows a page break", () => {
    // Paragraph bottoms at 550, 600; the wide block (after a 16 px margin) and a page break at 616.
    const pages = paginateMixed([550, 600, 700, 800], 1200, 1000, 700, [{ top: 616, bottom: 1000 }], new Set(), [], [616]);
    expect(pages.map((p) => [p.start, p.end, p.landscape])).toEqual([[0, 616, false], [616, 1200, true]]);
  });

  it("starts a new page at page breaks", () => {
    const pages = paginateMixed(rows(0, 2000), 2000, 1000, 700, [], new Set(), [], [420]);
    expect(pages.map((p) => [p.start, p.end])).toEqual([[0, 420], [420, 1400], [1400, 2000]]);
  });
});

describe("blank pages", () => {
  it("drops pages that only hold the space between blocks", () => {
    const pages = [
      { start: 0, end: 1000 },
      { start: 1000, end: 1048 },
      { start: 1048, end: 1700 },
    ];
    expect(dropBlankPages(pages, [{ top: 0, bottom: 1000 }, { top: 1048, bottom: 1600 }])).toEqual([pages[0], pages[2]]);
  });
});

describe("table column groups", () => {
  it("keeps tables that fit in one group", () => {
    expect(groupColumns([100, 100, 100], 400)).toEqual([[1, 2]]);
  });

  it("repeats the first column and fills groups greedily", () => {
    expect(groupColumns([100, 150, 150, 150, 150], 400)).toEqual([[1, 2], [3, 4]]);
  });

  it("gives an over-wide column a group of its own", () => {
    expect(groupColumns([100, 500, 100], 400)).toEqual([[1], [2]]);
  });
});

describe("orientation", () => {
  const sides = (...slots: (number | null)[][]): Side[] => slots.map((s) => ({ slots: s }));
  const landscape = new Set([1, 2]);
  const isLandscape = (p: number) => landscape.has(p);

  it("prefers the orientation that fits the pages", () => {
    expect(preferredOrientation("1", true)).toBe("landscape");
    expect(preferredOrientation("2", false)).toBe("landscape");
    expect(preferredOrientation("2", true)).toBe("portrait");
    expect(preferredOrientation("4", true)).toBe("landscape");
    expect(preferredOrientation("booklet", true)).toBe("landscape");
  });

  it("follows each page when printing one-sided", () => {
    expect(orientSides(sides([0], [1], [2], [3]), "1", "auto", isLandscape)).toEqual(["portrait", "landscape", "landscape", "portrait"]);
    expect(orientSides(sides([0, 1], [1, 2]), "2", "auto", isLandscape)).toEqual(["landscape", "portrait"]);
  });

  it("picks the flip edge from the dominant orientation", () => {
    const s = sides([0], [1], [2]);
    orientSides(s, "1", "auto", isLandscape).forEach((o, i) => (s[i].orientation = o));
    expect(dominantOrientation(s)).toBe("landscape");
    expect(dominantOrientation(sides([0]))).toBe("portrait");
  });

  it("respects a fixed choice and keeps booklets landscape", () => {
    expect(orientSides(sides([1], [0]), "1", "portrait", isLandscape)).toEqual(["portrait", "portrait"]);
    expect(orientSides(sides([0, 1]), "booklet", "portrait", isLandscape)).toEqual(["landscape"]);
  });
});

describe("placement", () => {
  const portraitSlot = { width: 198, height: 285 }; // A4 with 6 mm margins
  const landscapePage = { width: 297, height: 210 };

  it("fits and centres by default", () => {
    const p = placePage(portraitSlot, landscapePage, "fit", 0, "center", "center");
    expect(p.scale).toBeCloseTo(198 / 297);
    expect(p.width).toBeCloseTo(198);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo((285 - 140) / 2);
  });

  it("aligns to the edges", () => {
    expect(placePage(portraitSlot, landscapePage, "fit", 0, "left", "top").y).toBe(0);
    expect(placePage(portraitSlot, landscapePage, "fit", 0, "right", "bottom").y).toBeCloseTo(285 - 140);
    expect(placePage(portraitSlot, { width: 100, height: 100 }, "percent", 100, "right", "top")).toMatchObject({ x: 98, y: 0, scale: 1 });
  });

  it("uses a fixed percentage and lets oversized pages overflow", () => {
    const p = placePage(portraitSlot, landscapePage, "percent", 100, "center", "center");
    expect(p).toMatchObject({ scale: 1, width: 297, height: 210 });
    expect(p.x).toBeCloseTo((198 - 297) / 2);
  });

  it("scales to a target width or height in millimetres", () => {
    expect(placePage(portraitSlot, landscapePage, "width", 150, "center", "center")).toMatchObject({ width: 150 });
    expect(placePage(portraitSlot, landscapePage, "height", 100, "center", "center").height).toBeCloseTo(100);
    expect(placePage(portraitSlot, landscapePage, "height", 100, "center", "center").width).toBeCloseTo(141.43, 1);
  });

  it("computes slots from margins", () => {
    expect(slotSize(sheetGeometry("1", "a4", "portrait"), 6, true)).toEqual({ width: 198, height: 285 });
    // With margins at the fold every half is an A5 page with 10 mm on all sides.
    expect(slotSize(sheetGeometry("2", "a4", "landscape"), 10, true)).toEqual({ width: 148.5 - 20, height: 190 });
    // Without them the pages meet at the fold.
    expect(slotSize(sheetGeometry("2", "a4", "landscape"), 10, false)).toEqual({ width: (297 - 20) / 2, height: 190 });
    expect(slotSize(sheetGeometry("4", "a4", "portrait"), 5, true)).toEqual({ width: 105 - 10, height: 148.5 - 10 });
  });
});

describe("orientation markers", () => {
  const b = { block: true } as const;
  const m = (mark: MarkerValue) => ({ mark });

  it("parses marker comments", () => {
    expect(parseMarker(" Landscape ")).toBe("landscape");
    expect(parseMarker("landscape   START")).toBe("landscape start");
    expect(parseMarker("pagebreak")).toBe("page break");
    expect(parseMarker("sideways")).toBeNull();
    expect(markersToAnchors("<p>a</p>\n<!-- markdownz: portrait -->\n<!-- other -->")).toBe(
      '<p>a</p>\n<span class="mdz-mark" data-mdz="portrait"></span>\n<!-- other -->',
    );
  });

  it("applies a marker to the next block only", () => {
    const r = resolveMarkers([b, m("landscape"), b, b]);
    expect(r.orientation).toEqual([undefined, "landscape", undefined]);
  });

  it("applies ranges, with next-block markers winning inside", () => {
    const r = resolveMarkers([m("landscape start"), b, m("portrait"), b, b, m("landscape end"), b]);
    expect(r.orientation).toEqual(["landscape", "portrait", "landscape", undefined]);
  });

  it("records page breaks and unused markers", () => {
    const r = resolveMarkers([b, m("page break"), b, m("portrait end"), m("landscape")]);
    expect([...r.breaks]).toEqual([1]);
    expect(r.unused).toBe(2);
  });
});

describe("orientation exceptions", () => {
  it("lets your exception win over a marker, and says so", () => {
    expect(decide("portrait", "landscape")).toEqual({ orientation: "portrait", source: "yours", overrules: { source: "marker", orientation: "landscape" } });
    expect(decide(undefined, "landscape")).toEqual({ orientation: "landscape", source: "marker" });
    expect(decide(undefined, undefined)).toEqual({ orientation: undefined, source: "settings" });
  });

  it("anchors blocks by heading and text, not by position", () => {
    const a = makeAnchor("TABLE", "  Very   wide ", "Column0 Column1\n row0");
    expect(a).toEqual(makeAnchor("table", "very wide", "column0   column1 row0"));
    expect(a.hash).not.toBe(makeAnchor("table", "very wide", "column0 column2").hash);
  });

  it("prunes documents not opened for a long time", () => {
    const day = 24 * 3600 * 1000;
    const doc = (used: number) => ({ used, items: [{ anchor: makeAnchor("p", "", "x"), orientation: "landscape" as const, label: "x" }] });
    const now = 1000 * day;
    expect(Object.keys(pruneExceptions({ a: doc(now - day), b: doc(now - 200 * day), c: { used: now, items: [] } }, now))).toEqual(["a"]);
  });
});

describe("moved turns and marker edits", () => {
  it("parses a marker that moves a rule", () => {
    expect(parseMarkerText(" landscape start · moves rule of table A1B2C3D4 ")).toEqual({ value: "landscape start", moves: { tag: "table", hash: "a1b2c3d4" } });
    expect(parseMarkerText("portrait · moves rule of table a1b2c3d4")).toBeNull();
    expect(markerComment({ value: "landscape end", moves: { tag: "pre", hash: "0badcafe" } })).toBe("<!-- markdownz: landscape end · moves rule of pre 0badcafe -->");
  });

  it("collects moved turns apart from ordinary markers", () => {
    const r = resolveMarkers([{ block: true }, { mark: "landscape start", moves: { tag: "table", hash: "a1b2c3d4" } }, { block: true }, { block: true }]);
    expect(r.orientation).toEqual([undefined, undefined, undefined]);
    expect(r.shifts).toEqual([{ item: 1, value: "landscape start", moves: { tag: "table", hash: "a1b2c3d4" }, before: 1 }]);
  });

  const doc = "# A\r\n\r\n<!-- markdownz: landscape -->\r\n| t |\r\n|---|\r\n\r\ntext\r\n";

  it("moves, replaces, inserts and removes only marker lines, keeping line endings", () => {
    const moved = moveLine(doc, 2, 6);
    expect(moved).toBe("# A\r\n\r\n| t |\r\n|---|\r\n\r\n<!-- markdownz: landscape -->\r\ntext\r\n");
    expect(onlyMarkersChanged(doc, moved)).toBe(true);
    expect(replaceLine(doc, 2, "<!-- markdownz: portrait -->")).toContain("portrait -->\r\n| t |");
    expect(insertLine(doc, 6, "<!-- markdownz: page break -->").split("\r\n")[6]).toBe("<!-- markdownz: page break -->");
    expect(removeLine(doc, 2)).toBe("# A\r\n\r\n| t |\r\n|---|\r\n\r\ntext\r\n");
  });

  it("refuses edits that change anything but marker lines", () => {
    expect(onlyMarkersChanged(doc, doc.replace("text", "test"))).toBe(false);
    expect(isMarkerLine("  <!-- markdownz: landscape -->  ")).toBe(true);
    expect(isMarkerLine("<!-- other -->")).toBe(false);
  });
});
