// DXF plugin: dxf-viewer (three.js, WebGL). Wheel zooms and dragging pans the drawing;
// layers can be hidden; printing renders the whole drawing fitted to the paper.

import { DxfViewer } from "dxf-viewer";
import { Color } from "three";
import cyrillic from "@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff?inline";
import greek from "@fontsource/noto-sans/files/noto-sans-greek-400-normal.woff?inline";
import latinExt from "@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff?inline";
import latin from "@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff?inline";
import type { DocumentView, FindProvider, PrintPages, ViewContext } from "../../src/formats/types";
import type { PluginApi, PluginInstance } from "../../src/plugins/api";

export { PLUGIN_API as api } from "../../src/plugins/api";

const STYLE = `
.dxf-view { overflow: hidden; background: var(--bg); }
.dxf-canvas { position: absolute !important; inset: 0; } /* dxf-viewer sets position: relative */
.dxf-layers { position: absolute; top: 8px; right: 12px; max-height: calc(100% - 60px); overflow: auto; padding: 4px 8px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 6px; font-size: 12px; opacity: 0.95; }
.dxf-layers summary { cursor: pointer; }
.dxf-layers label { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.dxf-swatch { width: 10px; height: 10px; border: 1px solid var(--border); }
.dxf-caption { position: absolute; right: 12px; bottom: 8px; padding: 2px 8px; border-radius: 4px; background: var(--bg);
  color: var(--muted); font-size: 12px; pointer-events: none; }
`;

/** Fonts for text in drawings, as blob URLs (the WebView may fetch blobs, not data URLs). */
let fontUrls: string[] | null = null;
function fonts(): string[] {
  fontUrls ??= [latin, latinExt, cyrillic, greek].map((dataUrl) => {
    const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (c) => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: "font/woff" }));
  });
  return fontUrls;
}

/** Text encoding of the file: UTF-8 from AutoCAD 2007 (AC1021), before that the code page in the header. */
export function dxfEncoding(data: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(data.subarray(0, 64 * 1024));
  const value = (name: string) => new RegExp(`\\$${name}\\s*\\r?\\n\\s*\\d+\\s*\\r?\\n\\s*(\\S+)`).exec(head)?.[1];
  const version = value("ACADVER");
  if (!version || version >= "AC1021") return "utf-8";
  const page = /^ANSI_(\d+)$/i.exec(value("DWGCODEPAGE") ?? "");
  return page ? `windows-${page[1]}` : "windows-1252";
}

const background = () => getComputedStyle(document.body).backgroundColor || "#ffffff";
const round = (n: number) => (Math.abs(n) >= 100 ? Math.round(n) : Number(n.toPrecision(3)));

class DxfView implements DocumentView {
  readonly element: HTMLElement;
  private canvasHost: HTMLElement;
  private layers: HTMLDetailsElement;
  private caption: HTMLElement;
  private viewer: DxfViewer | null = null;

  readonly find: FindProvider = {
    find: () => this.find.onResult?.({ index: -1, count: 0 }),
    clear: () => {},
  };

  constructor(private api: PluginApi) {
    const el = api.el;
    this.canvasHost = el("div", { className: "dxf-canvas" });
    this.layers = el("details", { className: "dxf-layers" });
    this.layers.hidden = true;
    this.caption = el("div", { className: "dxf-caption" });
    this.element = el("div", { className: "doc-view dxf-view", tabIndex: -1 }, this.canvasHost, this.layers, this.caption);
  }

  async load(path: string): Promise<{ title?: string }> {
    const data = await this.api.readBinary(path);
    const url = URL.createObjectURL(new Blob([data as BlobPart]));
    this.viewer?.Destroy();
    this.canvasHost.replaceChildren();
    const viewer = new DxfViewer(this.canvasHost, {
      autoResize: true,
      clearColor: new Color(background()),
      colorCorrection: true,
      fileEncoding: dxfEncoding(data),
    });
    this.viewer = viewer;
    try {
      await viewer.Load({ url, fonts: fonts() });
    } finally {
      URL.revokeObjectURL(url);
    }
    this.showLayers(viewer);
    const bounds = viewer.GetBounds();
    const size = bounds ? `${round(bounds.maxX - bounds.minX)} × ${round(bounds.maxY - bounds.minY)} units` : "empty";
    this.caption.textContent = `DXF · ${size} · wheel zooms, drag pans`;
    return {};
  }

  private showLayers(viewer: DxfViewer): void {
    const el = this.api.el;
    const layers = [...viewer.GetLayers(true)].sort((a, b) => a.displayName.localeCompare(b.displayName));
    this.layers.hidden = layers.length < 2;
    this.layers.replaceChildren(
      el("summary", { textContent: `Layers (${layers.length})` }),
      ...layers.map((layer) => {
        const box = el("input", { type: "checkbox", checked: true });
        box.addEventListener("change", () => viewer.ShowLayer(layer.name, box.checked));
        const swatch = el("span", { className: "dxf-swatch" });
        swatch.style.background = `#${layer.color.toString(16).padStart(6, "0")}`;
        return el("label", {}, box, swatch, layer.displayName);
      }),
    );
  }

  async refresh(_ctx: ViewContext): Promise<void> {
    this.viewer?.SetClearColor(new Color(background()));
  }

  setZoom(): void {}

  scrollToFragment(): boolean {
    return false;
  }

  outline() {
    return [];
  }

  position(): number {
    return 0;
  }

  /** One sheet with the whole drawing on white, turned to match its shape, rendered at about 200 dpi. */
  async printPages(paper: { width: number; height: number }): Promise<PrintPages> {
    const viewer = this.viewer;
    const bounds = viewer?.GetBounds();
    if (!viewer || !bounds) throw new Error("the drawing is empty");
    const wide = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY;
    const size = wide === paper.width >= paper.height ? { ...paper } : { width: paper.height, height: paper.width };
    const scale = Math.min(200 / 25.4, 4096 / Math.max(size.width, size.height));

    const renderer = viewer.GetRenderer()!;
    const canvas = viewer.GetCanvas();
    const camera = viewer.GetCamera();
    const saved = { width: canvas.clientWidth, height: canvas.clientHeight, ratio: renderer.getPixelRatio(), view: [camera.left, camera.right, camera.top, camera.bottom] };
    renderer.setPixelRatio(1);
    viewer.SetClearColor(new Color("#ffffff"));
    viewer.SetSize(Math.round(size.width * scale), Math.round(size.height * scale));
    const origin = viewer.GetOrigin();
    viewer.FitView(bounds.minX - origin.x, bounds.maxX - origin.x, bounds.minY - origin.y, bounds.maxY - origin.y, 0.02);
    viewer.Render();
    const image = canvas.toDataURL("image/png");

    renderer.setPixelRatio(saved.ratio);
    viewer.SetSize(saved.width, saved.height);
    [camera.left, camera.right, camera.top, camera.bottom] = saved.view;
    camera.updateProjectionMatrix();
    viewer.SetClearColor(new Color(background()));

    return {
      count: 1,
      size: () => size,
      render: () => this.api.el("img", { className: "mdz-image-page", src: image, alt: "" }),
      dispose: () => {},
    };
  }

  dispose(): void {
    this.viewer?.Destroy();
    this.viewer = null;
    this.element.remove();
  }
}

export default function activate(api: PluginApi): PluginInstance {
  document.head.append(api.el("style", { textContent: STYLE }));
  return { createView: () => new DxfView(api) };
}
