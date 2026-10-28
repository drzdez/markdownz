import { describe, expect, it } from "vitest";
import { startOnNewSheets } from "../print/imposition";
import { cropText, emptyDoc, pruneExceptions, validCrop, withItems } from "../print/orientation";
import { parseViewFile, serializeViewFile, viewFileName, ViewStore, type ViewIO } from "../viewStore";
import { joinPages, parseProject, projectCrop, relativePath, serializeProject, withDocuments } from "./project";
import type { PrintPages } from "./types";

describe("print projects", () => {
  it("keeps documents relative to the project, so the folder can move", () => {
    const project = "C:\\Docs\\Trip\\all.mdzprint";
    const text = serializeProject(
      { documents: ["C:\\Docs\\Trip\\plan.md", "C:\\Docs\\Maps\\map.pdf", "D:\\Other\\x.pdf"], newSheets: true, crop: "documents" },
      project,
    );
    expect(JSON.parse(text).documents.map((d: { path: string }) => d.path)).toEqual(["plan.md", "../Maps/map.pdf", "D:\\Other\\x.pdf"]);
    const moved = parseProject(text, "E:\\Backup\\Trip\\all.mdzprint");
    expect(moved.documents).toEqual(["E:\\Backup\\Trip\\plan.md", "E:\\Backup\\Maps\\map.pdf", "D:\\Other\\x.pdf"]);
    expect(relativePath("/home/z/docs", "/home/z/docs/a/b.md")).toBe("a/b.md");
    expect(relativePath("\\\\server\\share\\a", "C:\\x.md")).toBe("C:\\x.md");
  });

  it("reads the common rules and rejects other files", () => {
    const project = parseProject(JSON.stringify({ markdownz: "markdownz print project", documents: ["a.md"], newSheets: false, crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 }, print: { layout: "4" } }), "/p/x.mdzprint");
    expect(project).toEqual({ documents: ["/p/a.md"], newSheets: false, crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 }, print: { layout: "4" } });
    expect(parseProject(JSON.stringify({ markdownz: "markdownz print project", crop: { x: 2 } }), "/p/x.mdzprint").crop).toBe("documents");
    expect(() => parseProject("{}", "/p/x.mdzprint")).toThrow();
  });

  it("gives the project's crop window priority over the document's own", () => {
    const own = { x: 0, y: 0, width: 0.5, height: 0.5 };
    const projects = { x: 0.5, y: 0.5, width: 0.5, height: 0.5 };
    expect(projectCrop("documents", own)).toEqual(own);
    expect(projectCrop("documents", null)).toBeNull();
    expect(projectCrop("none", own)).toBeNull();
    expect(projectCrop(projects, own)).toEqual(projects);
  });

  it("adds documents once, never another project", () => {
    const project = { documents: ["C:\\a.md"], newSheets: true, crop: "documents" as const };
    const { project: next, added } = withDocuments(project, ["c:/A.md", "C:\\b.pdf", "C:\\b.pdf", "C:\\other.mdzprint"]);
    expect(added).toEqual(["C:\\b.pdf"]);
    expect(next.documents).toEqual(["C:\\a.md", "C:\\b.pdf"]);
  });

  it("joins the pages of its documents", () => {
    const pages = (count: number, width: number, disposed: string[], name: string): PrintPages => ({
      count,
      size: () => ({ width, height: 297 }),
      render: (i) => Object.assign(document.createElement("div"), { textContent: `${name}${i}` }),
      dispose: () => disposed.push(name),
    });
    const disposed: string[] = [];
    const joined = joinPages([{ name: "a.md", pages: pages(2, 210, disposed, "a") }, { name: "b.pdf", pages: pages(3, 100, disposed, "b") }], true, () => disposed.push("views"));
    expect(joined.count).toBe(5);
    expect(joined.documents).toEqual([{ name: "a.md", first: 0, count: 2 }, { name: "b.pdf", first: 2, count: 3 }]);
    expect(joined.size(3).width).toBe(100);
    expect(joined.render(2).textContent).toBe("b0");
    joined.dispose();
    expect(disposed).toEqual(["a", "b", "views"]);
  });

  it("starts each document on a new sheet, on its front when two-sided", () => {
    // a: pages 0–2, b: 3–4, c: 5
    const all = [0, 1, 2, 3, 4, 5];
    expect(startOnNewSheets(all, [0, 3, 5], "4", "none")).toEqual([0, 1, 2, null, 3, 4, null, null, 5]);
    expect(startOnNewSheets(all, [0, 3, 5], "1", "long")).toEqual([0, 1, 2, null, 3, 4, 5]);
    expect(startOnNewSheets(all, [0, 3, 5], "2", "none")).toEqual([0, 1, 2, null, 3, 4, 5]);
    // A page range leaving out the first page of b still starts b on a new sheet.
    expect(startOnNewSheets([0, 4, 5], [0, 3, 5], "2", "none")).toEqual([0, null, 4, null, 5]);
    expect(startOnNewSheets(all, [0, 3, 5], "booklet", "short")).toEqual(all);
    expect(startOnNewSheets(all, [], "4", "none")).toEqual(all);
  });
});

describe("crop windows", () => {
  it("keeps a window on the page", () => {
    expect(validCrop({ x: -0.1, y: 0.5, width: 0.6, height: 0.8 })).toEqual({ x: 0, y: 0.5, width: 0.5, height: 0.5 });
    expect(validCrop({ x: 0.5, y: 0.5, width: 0.001, height: 0.4 })).toBeNull();
    expect(validCrop({ x: 0.5 })).toBeNull();
    expect(cropText({ x: 0.1, y: 0.05, width: 0.8, height: 0.4 })).toBe("left 10 %, top 5 %, 80 × 40 % of the page");
  });

  it("stays when the exceptions of the document are removed", () => {
    const crop = { x: 0, y: 0, width: 0.5, height: 0.5 };
    expect(withItems({ used: 1, items: [], crop }, [], 5)).toEqual({ used: 5, items: [], crop });
    expect(withItems({ used: 1, items: [] }, [], 5)).toBeUndefined();
    expect(emptyDoc({ used: 1, items: [], crop })).toBe(false);
    expect(Object.keys(pruneExceptions({ "/a.pdf": { used: 10, items: [], crop }, "/b.md": { used: 10, items: [] } }, 10))).toEqual(["/a.pdf"]);
  });
});

describe("view settings files", () => {
  const memory = () => {
    const files = new Map<string, string>();
    const io: ViewIO = {
      list: async () => [...files.values()],
      save: async (name, data) => void files.set(name, data),
      remove: async (name) => void files.delete(name),
      fingerprint: async (path) => (path.endsWith("gone.pdf") || path.endsWith("new.pdf") ? "100:abc" : "200:def"),
    };
    return { files, io };
  };

  it("are named after the document, one per full path", () => {
    expect(viewFileName("C:\\Docs\\Report Q3.pdf")).toMatch(/^Report Q3\.pdf-[0-9a-f]{8}\.json$/);
    expect(viewFileName("C:\\Docs\\Report Q3.pdf")).toBe(viewFileName("c:/docs/report q3.pdf".replace("report q3", "Report Q3")));
    expect(viewFileName("C:\\A\\x.md")).not.toBe(viewFileName("C:\\B\\x.md"));
    const text = serializeViewFile("/a.md", { used: 0, items: [] }, "1:2");
    expect(parseViewFile(text)).toMatchObject({ path: "/a.md", fingerprint: "1:2", items: [] });
    expect(parseViewFile("{}")).toBeNull();
  });

  it("are written when settings change and removed when none are left", async () => {
    const { files, io } = memory();
    const store = new ViewStore(io);
    const crop = { x: 0, y: 0, width: 0.5, height: 0.5 };
    expect(await store.sync({ "/a.pdf": { used: 1, items: [], crop }, "/b.md": { used: 1, items: [] } })).toBe(true);
    expect([...files.keys()]).toEqual([viewFileName("/a.pdf")]);
    expect(JSON.parse(files.get(viewFileName("/a.pdf"))!)).toMatchObject({ path: "/a.pdf", crop, fingerprint: "200:def" });
    const again = new ViewStore(io);
    expect(await again.load()).toEqual({ "/a.pdf": { used: 1, items: [], crop } });
    await again.sync({});
    expect(files.size).toBe(0);
  });

  it("follow a document that was moved", async () => {
    const { io } = memory();
    const store = new ViewStore(io);
    const all = { "/old/gone.pdf": { used: 1, items: [], crop: { x: 0, y: 0, width: 0.5, height: 0.5 } } };
    await store.sync(all);
    expect(await store.moved("/new/new.pdf", all, async () => false)).toBe("/old/gone.pdf");
    // Still there: a copy, not a move.
    expect(await store.moved("/new/new.pdf", all, async () => true)).toBeNull();
    expect(await store.moved("/new/other.pdf", all, async () => false)).toBeNull();
  });
});
