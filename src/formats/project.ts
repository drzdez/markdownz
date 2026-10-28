// Print projects (.mdzprint): several documents printed one after another as
// one job. Nothing about the documents changes: each keeps its own page breaks,
// orientation, parts of Excel sheets and crop windows; the project only says
// which documents in which order, and its common print rules (its own print
// settings, each document on a new sheet, and a crop window for PDF pages that
// takes priority over those of the documents).

import * as backend from "../backend";
import { basename, dirname, extname, isAbsolute, resolvePath, samePath } from "../paths";
import type { PrintOptions } from "../print/imposition";
import { cropText, validCrop, type Crop, type DocExceptions } from "../print/orientation";
import { showContextMenu } from "../ui/contextMenu";
import { el } from "../ui/overlay";
import type { DocumentView, FindProvider, FormatPlugin, PrintPages, ViewContext, ViewHost } from "./types";

export const PROJECT_KIND = "markdownz print project";
export const PROJECT_EXTENSION = "mdzprint";

/** Crop windows of PDF pages in a project: each document's own, none, or one window for all. */
export type ProjectCrop = "documents" | "none" | Crop;

export interface Project {
  /** Full paths, in print order. */
  documents: string[];
  /** Each document starts on a new sheet (on its front side when printing two-sided). */
  newSheets: boolean;
  crop: ProjectCrop;
  /** The project's own print settings; the common ones until it has them. */
  print?: Partial<PrintOptions>;
}

export const EMPTY_PROJECT: Project = { documents: [], newSheets: true, crop: "documents" };

/** Path of `to` relative to the folder `from` when both are on the same drive or root; else `to` itself. */
export function relativePath(from: string, to: string): string {
  const windows = /^[A-Za-z]:[\\/]|^\\\\/.test(from);
  const split = (p: string) => p.split(/[\\/]+/).filter(Boolean);
  const a = split(from);
  const b = split(to);
  const same = (x: string, y: string) => (windows ? x.toLowerCase() === y.toLowerCase() : x === y);
  if (!a.length || !b.length || !same(a[0], b[0]) || (windows && from.startsWith("\\\\") !== to.startsWith("\\\\"))) return to;
  let common = 0;
  while (common < a.length && common < b.length - 1 && same(a[common], b[common])) common++;
  return [...Array(a.length - common).fill(".."), ...b.slice(common)].join("/");
}

/** Reads a project file; document paths are resolved against the project's folder. */
export function parseProject(text: string, projectPath: string): Project {
  const data = JSON.parse(text) as { markdownz?: string; documents?: unknown; newSheets?: unknown; crop?: unknown; print?: unknown };
  if (data.markdownz !== PROJECT_KIND) throw new Error("not a Markdownz print project");
  const folder = dirname(projectPath);
  const documents = (Array.isArray(data.documents) ? data.documents : [])
    .map((d) => (typeof d === "string" ? d : typeof d === "object" && d && typeof (d as { path?: unknown }).path === "string" ? (d as { path: string }).path : ""))
    .filter(Boolean)
    .map((p) => (isAbsolute(p) ? p : resolvePath(folder, p)));
  const crop: ProjectCrop = data.crop === "none" ? "none" : (validCrop(data.crop as Crop) ?? "documents");
  return {
    documents,
    newSheets: data.newSheets !== false,
    crop,
    ...(data.print && typeof data.print === "object" ? { print: data.print as Partial<PrintOptions> } : {}),
  };
}

/** The project file: documents relative to the project's folder, so the folder can move as a whole. */
export function serializeProject(project: Project, projectPath: string): string {
  const folder = dirname(projectPath);
  return JSON.stringify(
    {
      markdownz: PROJECT_KIND,
      version: 1,
      documents: project.documents.map((path) => ({ path: relativePath(folder, path) })),
      newSheets: project.newSheets,
      crop: project.crop,
      ...(project.print ? { print: project.print } : {}),
    },
    null,
    2,
  );
}

/** The project with documents added at the end; documents already in it and other projects are left out. */
export function withDocuments(project: Project, paths: string[]): { project: Project; added: string[] } {
  const added: string[] = [];
  for (const path of paths) {
    if (extname(path) === PROJECT_EXTENSION || [...project.documents, ...added].some((d) => samePath(d, path))) continue;
    added.push(path);
  }
  return { project: { ...project, documents: [...project.documents, ...added] }, added };
}

/** Adds documents to a project file. */
export async function addToProjectFile(projectPath: string, paths: string[]): Promise<string[]> {
  const doc = await backend.readDoc(projectPath);
  const { project, added } = withDocuments(parseProject(doc.content, doc.path), paths);
  if (added.length) await backend.writeProject(doc.path, serializeProject(project, doc.path));
  return added;
}

/** The crop window for a document of the project: the project's rule, else the document's own. */
export function projectCrop(rule: ProjectCrop, own: Crop | null | undefined): Crop | null {
  if (rule === "none") return null;
  if (rule === "documents") return validCrop(own);
  return rule;
}

/** Pages of several documents as one document. */
export function joinPages(parts: { name: string; pages: PrintPages }[], newSheets: boolean, dispose: () => void): PrintPages {
  const documents: { name: string; first: number; count: number }[] = [];
  let first = 0;
  for (const part of parts) {
    documents.push({ name: part.name, first, count: part.pages.count });
    first += part.pages.count;
  }
  const at = (index: number) => {
    const i = documents.findIndex((d) => index < d.first + d.count);
    return { pages: parts[i].pages, index: index - documents[i].first };
  };
  return {
    count: first,
    documents,
    newSheets,
    size: (index) => {
      const p = at(index);
      return p.pages.size(p.index);
    },
    render: (index) => {
      const p = at(index);
      return p.pages.render(p.index);
    },
    dispose: () => {
      for (const part of parts) part.pages.dispose();
      dispose();
    },
  };
}

/** Finds the format plugin for a document; set by the app (the registry lists this format too). */
let formatOf: (path: string) => FormatPlugin | null = () => null;
let exceptions: Record<string, DocExceptions> = {};
const projectViews = new Set<ProjectView>();

export function setProjectFormats(resolve: (path: string) => FormatPlugin | null): void {
  formatOf = resolve;
}

/** A page saying why a document is missing from the print. */
function notePage(title: string, text: string): PrintPages {
  return {
    count: 1,
    size: () => ({ width: 210, height: 297 }),
    render: () =>
      el("div", { className: "mdz-project-note markdown-body" }, el("h2", { textContent: title }), el("p", { textContent: text })),
    dispose: () => {},
  };
}

const QUIET_HOST: ViewHost = { followLink() {}, onScroll() {} };

class ProjectView implements DocumentView {
  readonly element = el("section", { className: "doc-view project-view", tabIndex: -1 });
  /** Documents being laid out for print (never shown). */
  private hidden = el("div", { className: "project-hidden" });
  private body = el("article", { className: "markdown-body project-body" });
  readonly reflows = true;
  readonly find: FindProvider = {
    find() {
      this.onResult?.({ index: -1, count: 0 });
    },
    clear() {},
  };
  private path = "";
  private project: Project = { ...EMPTY_PROJECT };
  /** The text last read or written, so our own writes do not rebuild the editor. */
  private text = "";
  private saveTimer = 0;

  constructor(private host: ViewHost) {
    this.element.append(this.body, this.hidden);
    projectViews.add(this);
  }

  async load(path: string, _ctx: ViewContext): Promise<{ title?: string }> {
    const doc = await backend.readDoc(path);
    this.path = doc.path;
    if (doc.content !== this.text) {
      this.project = parseProject(doc.content, this.path);
      this.text = doc.content;
      this.render();
    }
    return { title: basename(this.path).replace(/\.mdzprint$/i, "") };
  }

  async refresh(): Promise<void> {
    this.render();
  }

  setZoom(zoom: number): void {
    this.element.style.setProperty("--zoom", String(zoom));
  }

  scrollToFragment(): boolean {
    return false;
  }

  outline() {
    return this.project.documents.map((path, i) => ({
      title: `${i + 1}. ${basename(path)}`,
      level: 1,
      activate: () => this.body.querySelectorAll(".project-doc")[i]?.scrollIntoView({ block: "center" }),
    }));
  }

  position(): number {
    return 0;
  }

  printSettings(): Partial<PrintOptions> | undefined {
    return this.project.print;
  }

  setPrintSettings(options: PrintOptions): void {
    if (JSON.stringify(options) === JSON.stringify(this.project.print)) return;
    this.project = { ...this.project, print: { ...options } };
    // The print dialog saves on every change; the file is written once it settles.
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(false), 500);
  }

  sources(): string[] {
    return this.project.documents;
  }

  /** Lays out every document with its own settings and joins the pages. */
  async printPages(
    paper: { width: number; height: number },
    onProgress?: (done: number, total: number) => void,
    layout?: Parameters<NonNullable<DocumentView["printPages"]>>[2],
  ): Promise<PrintPages> {
    const views: DocumentView[] = [];
    const parts: { name: string; pages: PrintPages }[] = [];
    const total = this.project.documents.length;
    try {
      for (const [i, path] of this.project.documents.entries()) {
        const name = basename(path);
        onProgress?.(i, total);
        const format = formatOf(path);
        if (!format || format.id === projectFormat.id) {
          parts.push({ name, pages: notePage(name, format ? "A print project cannot contain another one." : `No viewer is enabled for .${extname(path)} files.`) });
          continue;
        }
        const view = format.createView(QUIET_HOST);
        views.push(view);
        this.hidden.append(view.element);
        try {
          await view.load(path, { theme: "light", zoom: 1 });
          if (!view.printPages) {
            parts.push({ name, pages: notePage(name, "This document cannot be printed.") });
            continue;
          }
          // The project's crop window wins over the document's own (PDF pages).
          if (this.project.crop !== "documents") view.cropOverride = projectCrop(this.project.crop, null);
          parts.push({ name, pages: await view.printPages(paper, undefined, layout) });
        } catch (e) {
          parts.push({ name, pages: notePage(name, `Cannot be printed: ${e instanceof Error ? e.message : e}\n${path}`) });
        }
      }
      onProgress?.(total, total);
    } catch (e) {
      for (const part of parts) part.pages.dispose();
      for (const view of views) view.dispose();
      throw e;
    }
    return joinPages(parts, this.project.newSheets, () => views.forEach((v) => v.dispose()));
  }

  dispose(): void {
    projectViews.delete(this);
    clearTimeout(this.saveTimer);
    this.element.remove();
  }

  // ------------------------------------------------------------ editor

  private async save(rerender = true): Promise<void> {
    clearTimeout(this.saveTimer);
    const text = serializeProject(this.project, this.path);
    if (text === this.text) return;
    this.text = text;
    if (rerender) this.render();
    try {
      // The app notices the change and lays the pages out again.
      await backend.writeProject(this.path, text);
    } catch (e) {
      this.host.project?.notify(`Cannot save the project: ${e}`);
    }
  }

  private update(change: Partial<Project>): void {
    this.project = { ...this.project, ...change };
    void this.save();
  }

  private add(paths: string[]): void {
    const { project, added } = withDocuments(this.project, paths);
    if (added.length < paths.length) this.host.project?.notify("Left out: documents already in the project, and other print projects.");
    if (added.length) this.update({ documents: project.documents });
  }

  private render(): void {
    const project = this.project;
    const host = this.host.project;
    const button = (text: string, title: string, action: () => void, disabled = false) => {
      const b = el("button", { className: "mdz-settings-button", textContent: text, title, disabled });
      b.addEventListener("click", action);
      return b;
    };
    const move = (i: number, to: number) => {
      const documents = [...project.documents];
      const [doc] = documents.splice(i, 1);
      documents.splice(to, 0, doc);
      this.update({ documents });
    };
    const list = el(
      "ol",
      { className: "project-docs" },
      ...project.documents.map((path, i) => {
        const own = validCrop(exceptions[path]?.crop);
        const crop = extname(path) === "pdf" ? projectCrop(project.crop, own) : null;
        const cropNote =
          extname(path) !== "pdf"
            ? ""
            : crop
              ? `crop window ${project.crop === "documents" ? "of the document" : "of the project"}: ${cropText(crop)}`
              : project.crop === "none" && own
                ? "whole pages (the project ignores the document's crop window)"
                : "whole pages";
        return el(
          "li",
          { className: "project-doc" },
          el(
            "div",
            { className: "project-doc-text" },
            el("strong", { textContent: basename(path) }),
            el("div", { className: "mdz-hint", textContent: path }),
            ...(cropNote ? [el("div", { className: "mdz-hint", textContent: cropNote })] : []),
          ),
          el(
            "div",
            { className: "project-doc-buttons" },
            button("Open", "Open the document in a tab (its own settings: right-click its pages)", () => host?.open(path), !host),
            button("↑", "Print it earlier", () => move(i, i - 1), i === 0),
            button("↓", "Print it later", () => move(i, i + 1), i === project.documents.length - 1),
            button("✕", "Remove it from the project (the document stays)", () => this.update({ documents: project.documents.filter((_, n) => n !== i) })),
          ),
        );
      }),
    );
    const addFiles = button("Add documents…", "Choose documents to print after the others", () => {
      void host?.pick().then((paths) => this.add(paths));
    }, !host);
    const addOpen = button("Add an open document ▾", "One of the documents open in tabs", () => {
      const box = addOpen.getBoundingClientRect();
      const open = (host?.openDocuments() ?? []).filter((p) => extname(p) !== PROJECT_EXTENSION);
      showContextMenu(box.left, box.bottom + 4, open.length
        ? open.map((path) => ({ label: basename(path), detail: path, action: () => this.add([path]) }))
        : [{ label: "No other documents are open", disabled: true, action: () => {} }]);
    }, !host);

    const newSheets = el("input", { type: "checkbox", checked: project.newSheets });
    newSheets.addEventListener("change", () => this.update({ newSheets: newSheets.checked }));

    // Crop window of PDF pages: the documents' own, none, or one for all (it wins over theirs).
    const custom = typeof project.crop === "object" ? project.crop : null;
    const mode = el(
      "select",
      {},
      el("option", { value: "documents", textContent: "Each document's own (drawn in the document)" }),
      el("option", { value: "none", textContent: "None: whole pages" }),
      el("option", { value: "custom", textContent: "One window for all PDF documents" }),
    );
    mode.value = custom ? "custom" : (project.crop as string);
    const pct = (v: number) => String(Math.round(v * 1000) / 10);
    const fields = (["x", "y", "width", "height"] as const).map((key) => {
      const input = el("input", { type: "number", min: "0", max: "100", step: "0.5", value: pct(custom?.[key] ?? { x: 0, y: 0, width: 1, height: 1 }[key]) });
      return [key, input] as const;
    });
    const labels = { x: "Left %", y: "Top %", width: "Width %", height: "Height %" };
    const cropBox = el(
      "div",
      { className: "project-crop" },
      ...fields.map(([key, input]) => el("label", { className: "mdz-field" }, el("span", { textContent: labels[key] }), input)),
    );
    cropBox.hidden = !custom;
    const readWindow = (): Crop | null =>
      validCrop(Object.fromEntries(fields.map(([key, input]) => [key, Number(input.value) / 100])) as unknown as Crop);
    mode.addEventListener("change", () => {
      if (mode.value === "custom") {
        // Start from a crop window drawn in one of the documents, when there is one.
        const drawn = project.documents.map((p) => validCrop(exceptions[p]?.crop)).find(Boolean);
        this.update({ crop: drawn ?? readWindow() ?? { x: 0, y: 0, width: 1, height: 1 } });
      } else this.update({ crop: mode.value as "documents" | "none" });
    });
    for (const [, input] of fields) {
      input.addEventListener("change", () => {
        const crop = readWindow();
        if (crop) this.update({ crop });
        else host?.notify("The window must lie on the page and be at least 1 % wide and high.");
      });
    }
    const takeFrom = button("Take from a document ▾", "Use the crop window drawn in one of the PDF documents", () => {
      const box = takeFrom.getBoundingClientRect();
      const drawn = project.documents.map((p) => [p, validCrop(exceptions[p]?.crop)] as const).filter(([, c]) => c);
      showContextMenu(box.left, box.bottom + 4, drawn.length
        ? drawn.map(([p, c]) => ({ label: basename(p), detail: cropText(c!), action: () => this.update({ crop: c! }) }))
        : [{ label: "No document has a crop window", detail: "Right-click a PDF to draw one", disabled: true, action: () => {} }]);
    });
    cropBox.append(takeFrom);

    const printed = project.print ? "its own print settings (Ctrl+P changes them)" : "the common print settings until you print it (Ctrl+P), then its own";
    this.body.replaceChildren(
      el("h1", { textContent: basename(this.path).replace(/\.mdzprint$/i, "") }),
      el("p", {
        className: "mdz-hint",
        textContent:
          "A print project: these documents are printed one after another as one job, each with its own page breaks, orientation, parts of Excel sheets and crop windows. Ctrl+Shift+P shows the pages, Ctrl+P prints.",
      }),
      project.documents.length ? list : el("p", { textContent: "No documents yet." }),
      el("div", { className: "project-add" }, addFiles, addOpen),
      el(
        "fieldset",
        { className: "mdz-placement project-rules" },
        el("legend", { textContent: "Common print rules" }),
        el("label", {}, newSheets, " Each document starts on a new sheet"),
        el("label", { className: "mdz-field" }, el("span", { textContent: "Crop window of PDF pages" }), mode),
        cropBox,
        el("p", { className: "mdz-hint", textContent: "A window of the project takes priority over those drawn in the documents." }),
        el("p", { className: "mdz-hint", textContent: `Paper, pages per sheet, two-sided and the rest: ${printed}.` }),
      ),
    );
  }
}

export const projectFormat: FormatPlugin = {
  id: "project",
  name: "Print projects",
  description: ".mdzprint: several documents printed one after another as one job",
  extensions: [PROJECT_EXTENSION],
  defaultEnabled: true,
  configure(config) {
    const changed = JSON.stringify(exceptions) !== JSON.stringify(config.pageExceptions ?? {});
    exceptions = config.pageExceptions ?? {};
    // The crop windows of the documents are listed in the editor.
    if (changed) for (const view of projectViews) void view.refresh();
  },
  createView: (host) => new ProjectView(host),
};
