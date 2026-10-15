import type { DocumentView, FindProvider, OutlineItem, PrintPages, ViewContext, ViewHost } from "../formats/types";
import type { PageLayoutOptions } from "../print/imposition";
import { el } from "../ui/overlay";
import type { PluginInstance } from "./api";

/** Stands in for a plugin's view until its module is loaded, then passes everything on to it. */
export class PluginView implements DocumentView {
  private placeholder = el("div", { className: "doc-view", tabIndex: -1 });
  private view: DocumentView | null = null;

  /** The plugin's own element once loaded (it scrolls), so the app sees it directly. */
  get element(): HTMLElement {
    return this.view?.element ?? this.placeholder;
  }

  readonly find: FindProvider = {
    find: (query, direction, again) => {
      if (!this.view) return this.find.onResult?.({ index: -1, count: 0 });
      this.view.find.onResult = (result) => this.find.onResult?.(result);
      this.view.find.find(query, direction, again);
    },
    clear: () => this.view?.find.clear(),
  };

  constructor(
    private host: ViewHost,
    private instance: () => Promise<PluginInstance>,
  ) {}

  get reflows(): boolean | undefined {
    return this.view?.reflows;
  }

  async load(path: string, ctx: ViewContext): Promise<{ title?: string }> {
    if (!this.view) {
      const view = await (await this.instance()).createView(this.host, path);
      view.element.hidden = this.placeholder.hidden;
      this.placeholder.replaceWith(view.element);
      this.view = view;
      if (this.view.printPages) this.printPages = (paper, onProgress, layout) => this.view!.printPages!(paper, onProgress, layout);
    }
    return this.view.load(path, ctx);
  }

  printPages?: (paper: { width: number; height: number }, onProgress?: (done: number, total: number) => void, layout?: PageLayoutOptions) => Promise<PrintPages>;

  async refresh(ctx: ViewContext): Promise<void> {
    await this.view?.refresh(ctx);
  }

  setZoom(zoom: number): void {
    this.view?.setZoom(zoom);
  }

  scrollToFragment(fragment: string): boolean {
    return this.view?.scrollToFragment(fragment) ?? false;
  }

  outline(): OutlineItem[] {
    return this.view?.outline() ?? [];
  }

  position(): number {
    return this.view?.position() ?? 0;
  }

  dispose(): void {
    this.view?.dispose();
    this.placeholder.remove();
  }
}
