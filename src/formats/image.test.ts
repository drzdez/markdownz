import { describe, expect, it } from "vitest";
import { storedDpi, svgSize } from "./image";

describe("svgSize", () => {
  it("uses width and height with units", () => {
    expect(svgSize('<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm"/>')).toEqual({ width: 210, height: 297 });
  });
  it("falls back to the viewBox at 96 dpi", () => {
    const size = svgSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 48"/>')!;
    expect(size.width).toBeCloseTo(25.4);
    expect(size.height).toBeCloseTo(12.7);
  });
  it("keeps the aspect ratio when only the width is given", () => {
    expect(svgSize('<svg xmlns="http://www.w3.org/2000/svg" width="10cm" viewBox="0 0 200 100"/>')).toEqual({ width: 100, height: 50 });
  });
  it("returns null for something else", () => {
    expect(svgSize("<html/>")).toBeNull();
  });
});

describe("storedDpi", () => {
  it("reads the JFIF density of a JPEG", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, 1, 44, 1, 44, 0, 0, 0, 0]); // 300 dpi
    expect(storedDpi(jpeg)).toEqual({ x: 300, y: 300 });
  });
  it("reads pHYs of a PNG", () => {
    const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const chunk = (type: string, data: number[]) => [0, 0, 0, data.length, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
    const perMetre = [0, 0, 0x2e, 0x23]; // 11811 px/m = 300 dpi
    const png = new Uint8Array([...bytes, ...chunk("IHDR", new Array(13).fill(0)), ...chunk("pHYs", [...perMetre, ...perMetre, 1])]);
    const dpi = storedDpi(png)!;
    expect(Math.round(dpi.x)).toBe(300);
  });
  it("returns null without a stored resolution", () => {
    expect(storedDpi(new Uint8Array(32))).toBeNull();
  });
});
