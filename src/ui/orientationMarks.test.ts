import { describe, expect, it } from "vitest";
import type { BlockInfo } from "../formats/types";
import { markSpecs, pageTag, sameAsStandard, type MarksData } from "./orientationMarks";

const block = (i: number, extra: Partial<BlockInfo> = {}): BlockInfo => ({
  line: i * 2,
  end: i * 2 + 1,
  label: `table ${i}`,
  anchor: { tag: "table", heading: "", hash: String(i), key: `sheet:S${i}` },
  rule: false,
  source: "settings",
  ...extra,
});

const data = (blocks: BlockInfo[], inFile: boolean): MarksData => ({ blocks, marks: [], turnable: true, pageStarts: [], inFile });

describe("orientation marks", () => {
  it("in Excel and other converted formats, page and turn buttons set your exceptions", () => {
    const d = data([block(0), block(1, { rule: true })], false);
    // ⤒ on a page that splits a block: your page break, not a marker in the file.
    const tag = pageTag(d, { page: 2, block: 1, fraction: 0.5, cause: "auto", landscape: false })!;
    expect(tag.buttons[0][2]).toMatchObject({ type: "break", on: true, label: "table 1" });
    expect(tag.buttons[1][2]).toMatchObject({ type: "local", orientation: "landscape" });
    // The lock of a wide block: ✂ and ⟳ are yours, ⤒ turns the block above too.
    const rule = markSpecs(d).labels.find((l) => l.kind === "rule")!;
    const actions = rule.buttons.map((b) => b[2]?.type);
    expect(actions).toEqual(["local", undefined, "break", "local"]);
  });

  it("in Markdown, the same buttons write markers into the file", () => {
    const d = data([block(0), block(1)], true);
    const tag = pageTag(d, { page: 2, block: 1, fraction: 0.5, cause: "auto", landscape: false })!;
    expect(tag.buttons[0][2]).toMatchObject({ type: "insert", text: "<!-- markdownz: page break -->" });
  });

  it("highlights your exception only when it changes the print", () => {
    const portrait = block(0, { local: "portrait", decided: "portrait", source: "yours" });
    const landscape = block(1, { local: "landscape", decided: "landscape", source: "yours" });
    const asFile = block(2, { local: "landscape", file: "landscape", decided: "landscape", source: "yours" });
    expect([portrait, landscape, asFile].map(sameAsStandard)).toEqual([true, false, true]);
    const { labels, brackets } = markSpecs(data([portrait, landscape, asFile], false));
    expect(labels.filter((l) => l.kind.startsWith("yours")).map((l) => l.kind)).toEqual(["yours same", "yours", "yours same"]);
    expect(brackets.map((b) => b.kind)).toEqual(["same portrait", "yours landscape", "same landscape"]);
  });
});
