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

  /** `action`: a button that may fix it (install a plugin); its failure is shown below it. */
  constructor(path: string, error: unknown, hint = "", action?: { label: string; run(): Promise<void> }) {
    const button = action && el("button", { className: "primary", textContent: action.label });
    const status = el("p", { className: "mdz-hint" });
    button?.addEventListener("click", async () => {
      button.disabled = true;
      status.textContent = "Working…";
      try {
        await action!.run();
        status.textContent = "";
      } catch (e) {
        status.textContent = `Failed: ${e instanceof Error ? e.message : e}`;
        button.disabled = false;
      }
    });
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
        ...(button ? [el("p", {}, button), status] : []),
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
