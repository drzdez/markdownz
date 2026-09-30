import { el } from "../ui/overlay";
import type { DocumentView, FindProvider } from "./types";

/** Shown in a tab when its document cannot be opened. */
export class ErrorView implements DocumentView {
  readonly element: HTMLElement;
  readonly find: FindProvider = {
    find() {
      this.onResult?.({ index: -1, count: 0 });
    },
    clear() {},
  };

  constructor(path: string, error: unknown, hint = "") {
    this.element = el(
      "section",
      { className: "doc-view", tabIndex: -1 },
      el(
        "article",
        { className: "markdown-body mdz-error" },
        el("h1", { textContent: "Cannot open document" }),
        el("p", {}, el("code", { textContent: path })),
        el("pre", { textContent: error instanceof Error ? error.message : String(error) }),
        ...(hint ? [el("p", { textContent: hint })] : []),
      ),
    );
  }

  async load(): Promise<{ title?: string }> {
    return {};
  }

  async refresh(): Promise<void> {}
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

  dispose(): void {
    this.element.remove();
  }
}
