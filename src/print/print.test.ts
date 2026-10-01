import { describe, expect, it } from "vitest";
import { dominantOrientation, flipEdge, impose, orientSides, parseRange, passes, placePage, preferredOrientation, sheetCount, sheetGeometry, slotSize, type Side } from "./imposition";
import { paginate } from "./paginate";

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
    expect(slotSize(sheetGeometry("1", "a4", "portrait"), 6)).toEqual({ width: 198, height: 285 });
    expect(slotSize(sheetGeometry("2", "a4", "landscape"), 10)).toEqual({ width: (297 - 20 - 4) / 2, height: 190 });
  });
});
