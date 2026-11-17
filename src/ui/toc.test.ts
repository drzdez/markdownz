import { describe, expect, it } from "vitest";
import { detailSteps, TOC_WIDTH, tocWidth } from "./toc";

describe("table of contents width", () => {
  it("stays between the minimum and 60 % of the window", () => {
    expect(tocWidth(300, 1600)).toBe(300);
    expect(tocWidth(50, 1600)).toBe(160);
    expect(tocWidth(1500, 1600)).toBe(960);
    expect(tocWidth(Number.NaN, 1600)).toBe(TOC_WIDTH);
  });
});

describe("table of contents detail", () => {
  const item = (level: number, kind?: "item", depth?: number) => ({ title: "x", level, kind, depth, activate: () => {} });
  it("goes from the main chapters through the heading levels to the bullets", () => {
    const items = [item(1), item(2), item(3, "item", 0), item(4, "item", 1), item(3)];
    const { steps, step } = detailSteps(items);
    expect(steps).toBe(5);
    expect(items.map(step)).toEqual([1, 2, 4, 5, 3]);
    expect(detailSteps([]).steps).toBe(0);
    expect(detailSteps([item(1, "item", 0)]).steps).toBe(1);
  });
});
