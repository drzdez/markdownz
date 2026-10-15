import { describe, expect, it } from "vitest";
import { columnName } from "./index";

describe("Excel plugin", () => {
  it("names columns like Excel", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });
});
