import type { DocumentView, PrintPages } from "../formats/types";
import {
  DEFAULT_PRINT_OPTIONS,
  PAPERS,
  dominantOrientation,
  flipEdge,
  impose,
  orientSides,
  parseRange,
  passes,
  sheetCount,
  sheetGeometry,
  type AlignH,
  type AlignV,
  type Duplex,
  type Layout,
  type OrientationOption,
  type PrintOptions,
  type ScaleMode,
  type Side,
} from "../print/imposition";
import { buildSheet, printSides } from "../print/printJob";
import { el, openModal } from "./overlay";

const PX_PER_MM = 96 / 25.4;
const THUMB_HEIGHT = 190;
const MAX_PREVIEW = 12;

/**
 * Pages of the last dialog. They are released when the next dialog prepares its
 * pages, not on close: the system print dialog may still be using the images.
 */
let lastPages: PrintPages | null = null;

const LAYOUTS: [Layout, string][] = [
  ["1", "1 page per sheet"],
  ["2", "2 pages per sheet"],
  ["4", "4 pages per sheet"],
  ["booklet", "Booklet (fold in half)"],
];

/** The dialog offers one "printer" choice; the flip edge follows from the sheet orientation. */
type DuplexChoice = "none" | "printer" | "manual";
const toChoice = (d: Duplex): DuplexChoice => (d === "long" || d === "short" ? "printer" : d);

export function openPrintDialog(view: DocumentView, title: string, initial: PrintOptions, save: (options: PrintOptions) => void): void {
  const options = { ...initial };
  let pages: PrintPages | null = null;
  let pagesKey = "";
  /** Back sides waiting for the second pass of a manual two-sided job. */
  let manualBacks: Side[] | null = null;
  let generation = 0;

  const select = (values: [string, string][], value: string, change: (v: string) => void) => {
    const control = el("select", {}, ...values.map(([v, label]) => el("option", { value: v, textContent: label })));
    control.value = value;
    control.addEventListener("change", () => change(control.value));
    return control;
  };

  const radios = LAYOUTS.map(([value, label]) => {
    const input = el("input", { type: "radio", name: "mdz-layout", value, checked: options.layout === value });
    input.dataset.nav = "";
    input.addEventListener("change", () => {
      options.layout = value;
      // A booklet only makes sense two-sided.
      if (value === "booklet" && options.duplex === "none") {
        options.duplex = "short";
        duplex.value = "printer";
      }
      void changed();
    });
    return el("label", {}, input, ` ${label}`);
  });

  const orientation = select(
    [
      ["auto", "Auto (by page)"],
      ["portrait", "Portrait"],
      ["landscape", "Landscape"],
    ],
    options.orientation,
    (v) => {
      options.orientation = v as OrientationOption;
      void changed();
    },
  );

  const duplex = select(
    [
      ["none", "One-sided"],
      ["printer", "Two-sided (printer)"],
      ["manual", "Two-sided, manually (two passes)"],
    ],
    toChoice(options.duplex),
    (v) => {
      // The flip edge is filled in by changed() once the sheet orientation is known.
      options.duplex = v === "printer" ? "long" : (v as Duplex);
      void changed();
    },
  );

  const paper = select(
    [
      ["a4", "A4"],
      ["letter", "Letter"],
    ],
    options.paper,
    (v) => {
      options.paper = v as PrintOptions["paper"];
      void changed();
    },
  );

  const range = el("input", { type: "text", value: options.range, placeholder: "All, or e.g. 1-3, 5, 8-", spellcheck: false });
  range.addEventListener("input", () => {
    options.range = range.value;
    void changed();
  });

  // Only affects the second manual pass, so it must not restart the job.
  const reverse = el("input", { type: "checkbox", checked: options.reverseBacks });
  reverse.addEventListener("change", () => {
    options.reverseBacks = reverse.checked;
    save(options);
  });
  const reverseLabel = el("label", {}, reverse, " Back sides in reverse order");

  // Placement of the pages on the sheet.
  const scaleMode = select(
    [
      ["fit", "Fit"],
      ["percent", "%"],
      ["width", "Width mm"],
      ["height", "Height mm"],
    ],
    options.scaleMode,
    (v) => {
      options.scaleMode = v as ScaleMode;
      // Start from the real size: 100 % or the first page's real width/height.
      const first = pages?.size(0);
      if (options.scaleMode === "percent") options.scaleValue = 100;
      else if (options.scaleMode === "width") options.scaleValue = Math.round(first?.width ?? 210);
      else if (options.scaleMode === "height") options.scaleValue = Math.round(first?.height ?? 297);
      scaleValue.value = String(options.scaleValue);
      syncScale();
      void changed();
    },
  );
  const scaleValue = el("input", { type: "number", min: "1", max: "2000", step: "1", value: String(options.scaleValue) });
  scaleValue.addEventListener("input", () => {
    const value = Number(scaleValue.value);
    if (scaleValue.value.trim() && value > 0) {
      options.scaleValue = value;
      void changed();
    }
  });
  function syncScale(): void {
    scaleValue.disabled = options.scaleMode === "fit";
    scaleValue.title = { fit: "", percent: "Percent of the real page size", width: "Width of each page on paper, mm", height: "Height of each page on paper, mm" }[options.scaleMode];
  }
  const scale = el("div", { className: "mdz-scale" }, scaleMode, scaleValue);
  const alignH = select(
    [
      ["left", "Left"],
      ["center", "Center"],
      ["right", "Right"],
    ],
    options.alignH,
    (v) => {
      options.alignH = v as AlignH;
      void changed();
    },
  );
  const alignV = select(
    [
      ["top", "Top"],
      ["center", "Middle"],
      ["bottom", "Bottom"],
    ],
    options.alignV,
    (v) => {
      options.alignV = v as AlignV;
      void changed();
    },
  );
  const margin = el("input", { type: "number", min: "0", max: "40", step: "1", value: String(options.margin) });
  margin.addEventListener("input", () => {
    const value = Number(margin.value);
    if (margin.value.trim() && value >= 0 && value <= 40) {
      options.margin = value;
      void changed();
    }
  });
  const border = el("input", { type: "checkbox", checked: options.border });
  border.addEventListener("change", () => {
    options.border = border.checked;
    void changed();
  });

  const marginFrame = el("input", { type: "checkbox", checked: options.marginFrame });
  marginFrame.addEventListener("change", () => {
    options.marginFrame = marginFrame.checked;
    void changed();
  });

  const summary = el("p", { className: "mdz-print-summary" });
  const hint = el("p", { className: "mdz-hint" });
  const printButton = el("button", { className: "primary", textContent: "Print…" });
  const cancel = el("button", { textContent: "Cancel" });
  const reset = el("button", { textContent: "Reset", title: "Back to defaults: auto where possible, two-sided, 1 page per sheet, no margins, no frames" });
  const preview = el("div", { className: "mdz-print-preview" });

  const field = (label: string, control: HTMLElement) => el("label", { className: "mdz-field" }, el("span", { textContent: label }), control);
  const form = el(
    "div",
    { className: "mdz-print-form" },
    el("fieldset", {}, el("legend", { textContent: "Layout" }), ...radios),
    field("Orientation", orientation),
    field("Two-sided", duplex),
    reverseLabel,
    field("Paper", paper),
    field("Pages", range),
    el(
      "fieldset",
      { className: "mdz-placement" },
      el("legend", { textContent: "Placement" }),
      field("Scale", scale),
      field("Horizontal", alignH),
      field("Vertical", alignV),
      field("Margins mm", margin),
      el("label", {}, border, " Frame around each page"),
      el("label", {}, marginFrame, " Frame along the sheet margins"),
    ),
    summary,
    hint,
    el("div", { className: "mdz-print-buttons" }, reset, el("span", { className: "spacer" }), cancel, printButton),
  );

  const layer = openModal(`Print – ${title}`, el("div", { className: "mdz-print" }, form, preview), { className: "print" });
  cancel.addEventListener("click", () => layer.close());
  reset.addEventListener("click", () => {
    Object.assign(options, DEFAULT_PRINT_OPTIONS);
    syncControls();
    void changed();
  });
  syncScale();

  /** Puts every control in line with `options` (after Reset). */
  function syncControls(): void {
    for (const radio of radios.map((label) => label.querySelector("input")!)) radio.checked = radio.value === options.layout;
    orientation.value = options.orientation;
    duplex.value = toChoice(options.duplex);
    paper.value = options.paper;
    range.value = options.range;
    reverse.checked = options.reverseBacks;
    scaleMode.value = options.scaleMode;
    scaleValue.value = String(options.scaleValue);
    alignH.value = options.alignH;
    alignV.value = options.alignV;
    margin.value = String(options.margin);
    border.checked = options.border;
    marginFrame.checked = options.marginFrame;
    syncScale();
  }

  /**
   * Pages depend on the paper; Markdown printed one page per landscape sheet is
   * paginated for the landscape width. (PDF pages keep their own size.)
   */
  async function getPages(): Promise<PrintPages> {
    const p = PAPERS[options.paper];
    const wide = options.layout === "1" && options.orientation === "landscape";
    const format = wide ? { width: p.height, height: p.width } : p;
    const key = `${options.paper}:${wide}`;
    if (pages && pagesKey === key) return pages;
    if (pages && pages !== lastPages) pages.dispose();
    lastPages?.dispose();
    lastPages = null;
    pages = null;
    summary.textContent = "Preparing pages…";
    const result = await view.printPages!(format, (done, total) => {
      summary.textContent = `Preparing pages… ${done}/${total}`;
    });
    pages = lastPages = result;
    pagesKey = key;
    return result;
  }

  function describe(sides: Side[]): void {
    reverseLabel.hidden = options.duplex !== "manual";
    orientation.disabled = options.layout === "booklet";
    const orientations = new Set(sides.map((s) => s.orientation));
    const edge = flipEdge(dominantOrientation(sides));
    let text: string;
    if (manualBacks) {
      text =
        "Take the printed sheets, turn the stack over without changing its order and put it back into the paper tray. Then print the back sides. If pages end up in the wrong order, toggle “Back sides in reverse order” and try again.";
    } else if (options.duplex === "manual") {
      text = "First the front sides are printed. Markdownz then tells you how to put the paper back for the back sides.";
    } else if (options.duplex !== "none") {
      text = `In the system print dialog choose “Print on both sides” and flip on the ${edge} edge.`;
      if (orientations.size > 1) text += " Landscape sheets are turned on the paper, like in a PDF with mixed pages.";
    } else if (options.layout === "booklet") {
      text = "A booklet needs two-sided printing: choose “Two-sided (printer)” or “manually”.";
    } else {
      text = orientations.size > 1 ? "Portrait and landscape sheets are mixed to follow the pages." : "";
    }
    if (options.layout === "booklet") text += " Fold the printed stack in the middle.";
    hint.textContent = `${text} Keep the scale at 100 % / default in the system dialog.`.trim();
  }

  async function changed(): Promise<void> {
    manualBacks = null;
    printButton.textContent = options.duplex === "manual" ? "Print front sides…" : "Print…";
    const token = ++generation;
    let source: PrintPages;
    try {
      source = await getPages();
    } catch (e) {
      summary.textContent = `Cannot prepare pages: ${e}`;
      printButton.disabled = true;
      return;
    }
    if (token !== generation) return;
    const selection = parseRange(options.range, source.count);
    printButton.disabled = !selection?.length;
    if (!selection) {
      summary.textContent = `Invalid page range (document has ${source.count} pages).`;
      preview.replaceChildren();
      save(options);
      return;
    }

    const isLandscape = (i: number) => source.size(i).width > source.size(i).height;
    const sides = impose(selection, options.layout);
    orientSides(sides, options.layout, options.orientation, isLandscape).forEach((o, i) => (sides[i].orientation = o));
    if (options.duplex === "long" || options.duplex === "short") options.duplex = flipEdge(dominantOrientation(sides));
    save(options);

    const sheets = sheetCount(sides.length, options.duplex);
    summary.textContent = `${selection.length} of ${source.count} pages → ${sheets} ${sheets === 1 ? "sheet" : "sheets"} of paper`;
    describe(sides);
    renderPreview(sides, source);
    printButton.onclick = () => void run(sides, source);
  }

  function renderPreview(sides: Side[], source: PrintPages): void {
    const twoSided = options.duplex !== "none";
    const thumbs: HTMLElement[] = sides.slice(0, MAX_PREVIEW).map((side, i) => {
      const geo = sheetGeometry(options.layout, options.paper, side.orientation ?? "portrait");
      const scale = THUMB_HEIGHT / (geo.height * PX_PER_MM);
      const sheet = buildSheet(side, geo, source, options);
      sheet.style.transform = `scale(${scale})`;
      sheet.style.transformOrigin = "0 0";
      const box = el("div", { className: "mdz-thumb-sheet" }, sheet);
      box.style.width = `${geo.width * PX_PER_MM * scale}px`;
      box.style.height = `${THUMB_HEIGHT}px`;
      const label = twoSided ? `Sheet ${Math.floor(i / 2) + 1}, ${i % 2 ? "back" : "front"}` : `Sheet ${i + 1}`;
      return el("figure", { className: "mdz-thumb" }, box, el("figcaption", { textContent: label }));
    });
    if (sides.length > MAX_PREVIEW) thumbs.push(el("p", { className: "mdz-hint", textContent: `… and ${sides.length - MAX_PREVIEW} more sides` }));
    preview.replaceChildren(...thumbs);
  }

  async function run(sides: Side[], source: PrintPages): Promise<void> {
    if (options.duplex !== "manual") {
      await printSides(sides, options, source);
      layer.close();
      return;
    }
    const [fronts, backs] = passes(sides, "manual", options.reverseBacks);
    if (!manualBacks) {
      await printSides(fronts, options, source);
      manualBacks = backs;
      printButton.textContent = "Print back sides…";
      describe(sides);
      return;
    }
    await printSides(backs, options, source);
    layer.close();
  }

  void changed();
}
