import * as backend from "../backend";
import { extname } from "../paths";
import { el } from "../ui/overlay";
import type { DocumentView, FindProvider, FormatPlugin, OutlineItem, PrintPages, ViewContext } from "./types";

const MIME: Record<string, string> = {
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  pjpeg: "image/jpeg",
  pjp: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  cur: "image/x-icon",
  svg: "image/svg+xml",
};

const MM_PER_INCH = 25.4;
const CSS_DPI = 96;

/** Print resolution stored in the file (PNG pHYs, JPEG JFIF), dots per inch; null when there is none. */
export function storedDpi(data: Uint8Array): { x: number; y: number } | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // PNG: signature, then chunks; pHYs comes before IDAT.
  if (data.length > 16 && view.getUint32(0) === 0x89504e47) {
    for (let at = 8; at + 12 <= data.length; ) {
      const length = view.getUint32(at);
      const type = String.fromCharCode(...data.subarray(at + 4, at + 8));
      if (type === "pHYs" && length >= 9 && data[at + 16] === 1) {
        const perMetre = (o: number) => view.getUint32(at + 8 + o) * 0.0254;
        return valid({ x: perMetre(0), y: perMetre(4) });
      }
      if (type === "IDAT" || type === "IEND") return null;
      at += 12 + length;
    }
    return null;
  }
  // JPEG: APP0 "JFIF" segment right after SOI.
  if (data.length > 20 && view.getUint16(0) === 0xffd8 && view.getUint16(2) === 0xffe0 && String.fromCharCode(...data.subarray(6, 10)) === "JFIF") {
    const units = data[13];
    const x = view.getUint16(14);
    const y = view.getUint16(16);
    if (units === 1) return valid({ x, y });
    if (units === 2) return valid({ x: x * 2.54, y: y * 2.54 });
  }
  return null;
}

const valid = (dpi: { x: number; y: number }) => (dpi.x >= 30 && dpi.y >= 30 && dpi.x <= 10000 && dpi.y <= 10000 ? dpi : null);

const UNIT_MM: Record<string, number> = { "": MM_PER_INCH / CSS_DPI, px: MM_PER_INCH / CSS_DPI, mm: 1, cm: 10, in: MM_PER_INCH, pt: MM_PER_INCH / 72, pc: MM_PER_INCH / 6 };

/** Size of an SVG drawing in mm from its width/height (units honoured) or viewBox; null when unknown. */
export function svgSize(text: string): { width: number; height: number } | null {
  const root = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
  if (root.nodeName !== "svg") return null;
  const length = (name: string) => {
    const m = /^\s*([\d.]+)\s*(px|mm|cm|in|pt|pc)?\s*$/.exec(root.getAttribute(name) ?? "");
    return m ? Number(m[1]) * UNIT_MM[m[2] ?? ""] : null;
  };
  const box = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const [bw, bh] = box.length === 4 && box[2] > 0 && box[3] > 0 ? [box[2], box[3]] : [0, 0];
  let width = length("width");
  let height = length("height");
  if (width && !height && bw) height = (width * bh) / bw;
  if (height && !width && bh) width = (height * bw) / bh;
  if (!width || !height) {
    if (!bw) return null;
    [width, height] = [bw * UNIT_MM.px, bh * UNIT_MM.px];
  }
  return { width, height };
}

/** Turns a file of another picture format into one the WebView shows (PNG), for plugins (TIFF, HEIC). */
export type ToImage = (data: Uint8Array, path: string) => Promise<{ image: Blob; dpi?: { x: number; y: number }; label?: string }>;

const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

class ImageView implements DocumentView {
  readonly element = el("div", { className: "doc-view image-view", tabIndex: -1 });
  /** Scrolls the picture; the caption stays outside it, in the corner of the window. */
  private scroller = el("div", { className: "image-scroller" });
  private stage = el("div", { className: "image-stage" });
  private img = el("img", { className: "image-picture", alt: "", draggable: false });
  private caption = el("div", { className: "image-caption" });
  private url = "";
  private zoom = 1;
  /** Natural size in CSS px, and the size on paper in mm. */
  private natural = { width: 0, height: 0 };
  private paper = { width: 0, height: 0 };
  private resizeFrame = 0;

  readonly find: FindProvider = {
    find: () => this.find.onResult?.({ index: -1, count: 0 }),
    clear: () => {},
  };

  constructor(private toImage?: ToImage) {
    this.stage.append(this.img);
    this.scroller.append(this.stage);
    this.element.append(this.scroller, this.caption);
    new ResizeObserver(() => {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => this.layout());
    }).observe(this.element);
    this.dragToPan();
  }

  async load(path: string, ctx: ViewContext): Promise<{ title?: string }> {
    const ext = extname(path);
    const data = await backend.readBinary(path);
    const converted = this.toImage ? await this.toImage(data, path) : null;
    const url = URL.createObjectURL(converted?.image ?? new Blob([data as BlobPart], { type: MIME[ext] ?? "application/octet-stream" }));
    const img = this.img;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`cannot show this ${ext.toUpperCase()} image (damaged or an unsupported variant)`));
      img.src = url;
    });
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = url;

    let mm: { width: number; height: number } | null = null;
    if (ext === "svg") mm = svgSize(new TextDecoder().decode(data));
    const width = img.naturalWidth || (mm ? mm.width / UNIT_MM.px : 800);
    const height = img.naturalHeight || (mm ? mm.height / UNIT_MM.px : 600);
    this.natural = { width, height };
    const dpi = converted ? (converted.dpi ?? null) : ext === "svg" ? null : storedDpi(data);
    this.paper = mm ?? {
      width: (width * MM_PER_INCH) / (dpi?.x ?? CSS_DPI),
      height: (height * MM_PER_INCH) / (dpi?.y ?? CSS_DPI),
    };
    const pixels = ext === "svg" ? "vector" : `${img.naturalWidth} × ${img.naturalHeight} px`;
    const print = `${Math.round(this.paper.width)} × ${Math.round(this.paper.height)} mm${dpi ? ` at ${Math.round(dpi.x)} dpi` : ""}`;
    this.caption.textContent = `${converted?.label ?? ext.toUpperCase()} · ${pixels} · ${formatBytes(data.length)} · ${print}`;
    this.zoom = ctx.zoom;
    this.layout();
    return {};
  }

  async refresh(ctx: ViewContext): Promise<void> {
    this.setZoom(ctx.zoom);
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    this.layout();
  }

  /** 100 % fits the whole picture into the window; small pictures are never enlarged by the fit. */
  private layout(): void {
    const { width, height } = this.natural;
    if (!width || !height || !this.scroller.clientWidth) return;
    const room = { width: this.scroller.clientWidth - 32, height: this.scroller.clientHeight - 32 };
    const fit = Math.min(1, room.width / width, room.height / height);
    const scale = Math.max(fit, 0.01) * this.zoom;
    Object.assign(this.img.style, { width: `${width * scale}px`, height: `${height * scale}px` });
    // Enlarged pixels stay sharp squares instead of a blur.
    this.img.classList.toggle("pixelated", this.img.naturalWidth > 0 && scale >= 2);
  }

  /** Dragging a picture larger than the window moves it, like a scroll. */
  private dragToPan(): void {
    this.img.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const view = this.scroller;
      if (view.scrollWidth <= view.clientWidth && view.scrollHeight <= view.clientHeight) return;
      const start = { x: e.clientX, y: e.clientY, left: view.scrollLeft, top: view.scrollTop };
      this.img.setPointerCapture(e.pointerId);
      this.element.classList.add("panning");
      const move = (m: PointerEvent) => {
        view.scrollLeft = start.left - (m.clientX - start.x);
        view.scrollTop = start.top - (m.clientY - start.y);
      };
      const end = () => {
        this.element.classList.remove("panning");
        this.img.removeEventListener("pointermove", move);
      };
      this.img.addEventListener("pointermove", move);
      this.img.addEventListener("pointerup", end, { once: true });
      this.img.addEventListener("pointercancel", end, { once: true });
    });
  }

  scrollToFragment(): boolean {
    return false;
  }

  outline(): OutlineItem[] {
    return [];
  }

  position(): number {
    return 0;
  }

  /** One page of the picture's size on paper (its stored dpi, else 96 dpi); the print settings fit or scale it. */
  async printPages(): Promise<PrintPages> {
    const url = this.url;
    const size = { ...this.paper };
    return {
      count: 1,
      size: () => size,
      render: () => el("img", { className: "mdz-image-page", src: url, alt: "" }),
      dispose: () => {},
    };
  }

  dispose(): void {
    if (this.url) URL.revokeObjectURL(this.url);
    this.element.remove();
  }
}

/** A picture view for a format converted by a plugin. */
export function createImageView(toImage: ToImage): DocumentView {
  return new ImageView(toImage);
}

export const imageFormat: FormatPlugin = {
  id: "image",
  name: "Images",
  description: "PNG, JPEG, GIF, WebP, AVIF, BMP, ICO and SVG pictures: fit to the window, zoom, print",
  extensions: Object.keys(MIME),
  defaultEnabled: true,
  fitsWindow: true,
  createView: () => new ImageView(),
};
