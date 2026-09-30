import { describe, expect, it } from "vitest";
import { HistoryTree } from "./history";
import { classifyLink } from "./links";
import { basename, dirname, resolvePath, samePath } from "./paths";
import { dropIndex, indicesToClose, moveItem } from "./tabops";

describe("paths", () => {
  it("resolves POSIX paths", () => {
    expect(resolvePath("/docs/a", "../b/c.md")).toBe("/docs/b/c.md");
    expect(resolvePath("/docs", "./x/./y.md")).toBe("/docs/x/y.md");
    expect(resolvePath("/docs", "/etc/z.md")).toBe("/etc/z.md");
    expect(resolvePath("/", "../../a.md")).toBe("/a.md");
  });

  it("resolves Windows paths", () => {
    expect(resolvePath("C:\\docs\\a", "..\\b/c.md")).toBe("C:\\docs\\b\\c.md");
    expect(resolvePath("C:\\", "x.md")).toBe("C:\\x.md");
    expect(resolvePath("C:\\docs", "D:/other/y.md")).toBe("D:\\other\\y.md");
    expect(resolvePath("\\\\srv\\share\\dir", "../z.md")).toBe("\\\\srv\\share\\z.md");
  });

  it("splits paths", () => {
    expect(dirname("C:\\docs\\a.md")).toBe("C:\\docs");
    expect(dirname("C:\\a.md")).toBe("C:\\");
    expect(dirname("/a.md")).toBe("/");
    expect(basename("/x/y/readme.md")).toBe("readme.md");
  });

  it("compares Windows paths case-insensitively", () => {
    expect(samePath("C:\\Docs\\A.md", "c:/docs/a.md")).toBe(true);
    expect(samePath("/Docs/A.md", "/docs/a.md")).toBe(false);
  });
});

describe("links", () => {
  const doc = "/home/u/notes/index.md";

  it("classifies link kinds", () => {
    expect(classifyLink("#intro", doc)).toEqual({ kind: "anchor", id: "intro" });
    expect(classifyLink("https://example.com", doc)).toEqual({ kind: "external", url: "https://example.com" });
    expect(classifyLink("mailto:a@b.c", doc)?.kind).toBe("external");
    expect(classifyLink("sub/page.md#part-2", doc)).toEqual({
      kind: "doc",
      path: "/home/u/notes/sub/page.md",
      hash: "part-2",
    });
    expect(classifyLink("../img/a%20b.png", doc)).toEqual({ kind: "file", path: "/home/u/img/a b.png" });
    expect(classifyLink("?x=1#top", doc)).toEqual({ kind: "anchor", id: "top" });
  });

  it("handles file URLs and drive letters", () => {
    expect(classifyLink("file:///C:/docs/x.md", "C:\\a\\b.md")).toEqual({ kind: "doc", path: "C:/docs/x.md", hash: "" });
    expect(classifyLink("D:\\y.md", "C:\\a\\b.md")).toEqual({ kind: "doc", path: "D:\\y.md", hash: "" });
  });
});

describe("history tree", () => {
  it("keeps branches when navigating after going back", () => {
    const h = new HistoryTree("a");
    h.navigate("b");
    h.back();
    h.navigate("c");
    expect(h.current.path).toBe("c");
    h.back();
    expect(h.current.path).toBe("a");
    expect(h.forwardOptions().map((n) => n.path)).toEqual(["c", "b"]);
    expect(h.forward()).toBeNull(); // ambiguous: caller has to pick
    const b = h.forwardOptions()[1];
    expect(h.forward(b.id)?.path).toBe("b");
    h.back();
    expect(h.forwardOptions()[0].path).toBe("b");
  });

  it("reuses an existing child for the same path", () => {
    const h = new HistoryTree("a");
    const b1 = h.navigate("b");
    h.back();
    const b2 = h.navigate("b");
    expect(b2.id).toBe(b1.id);
    expect(h.root.children).toHaveLength(1);
  });

  it("forwards directly with a single child", () => {
    const h = new HistoryTree("a");
    h.navigate("b");
    h.back();
    expect(h.forward()?.path).toBe("b");
    expect(h.canForward).toBe(false);
  });

  it("goto marks the path for later forward", () => {
    const h = new HistoryTree("a");
    const b = h.navigate("b");
    h.navigate("c");
    h.back();
    h.back();
    h.navigate("d");
    h.goto(b.id);
    h.back();
    expect(h.forwardOptions()[0].path).toBe("b");
  });

  it("round-trips through JSON", () => {
    const h = new HistoryTree("a");
    h.navigate("b").scroll = 120;
    const copy = HistoryTree.fromJSON(JSON.parse(JSON.stringify(h.toJSON())));
    expect(copy.current.path).toBe("b");
    expect(copy.current.scroll).toBe(120);
    expect(copy.navigate("c").id).toBe(2);
  });
});

describe("tab operations", () => {
  it("selects tabs to close", () => {
    expect(indicesToClose(5, 2, "this")).toEqual([2]);
    expect(indicesToClose(5, 2, "others")).toEqual([0, 1, 3, 4]);
    expect(indicesToClose(5, 2, "right")).toEqual([3, 4]);
    expect(indicesToClose(5, 2, "left")).toEqual([0, 1]);
    expect(indicesToClose(3, 0, "all")).toEqual([0, 1, 2]);
    expect(indicesToClose(3, 2, "right")).toEqual([]);
  });

  it("moves items", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(["a", "b"], 0, 9)).toEqual(["b", "a"]);
  });

  it("computes drop position from pointer", () => {
    expect(dropIndex(5, [10, 30, 50])).toBe(0);
    expect(dropIndex(35, [10, 30, 50])).toBe(2);
    expect(dropIndex(99, [10, 30, 50])).toBe(3);
  });
});
