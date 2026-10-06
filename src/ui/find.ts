import type { FindProvider } from "../formats/types";
import { pushLayer, removeLayer, type Layer } from "./overlay";

/** Find bar; the actual searching is done by the active view's FindProvider. */
export class Finder {
  private bar = document.getElementById("findbar")!;
  private input = document.getElementById("find-input") as HTMLInputElement;
  private count = document.getElementById("find-count")!;
  private provider: FindProvider | null = null;
  private layer: Layer = {
    close: () => this.close(),
    onKey: (e) => {
      if (e.key === "Enter" || e.key === "F3") {
        this.step(e.shiftKey ? -1 : 1);
        return true;
      }
      return false;
    },
  };

  /** `getProvider` may return a message explaining why the active document cannot be searched. */
  constructor(private getProvider: () => FindProvider | string | null, private onClose: () => void) {
    this.input.addEventListener("input", () => this.run(1, false));
    document.getElementById("find-next")!.addEventListener("click", () => this.step(1));
    document.getElementById("find-prev")!.addEventListener("click", () => this.step(-1));
    document.getElementById("find-close")!.addEventListener("click", () => this.close());
  }

  get isOpen(): boolean {
    return !this.bar.hidden;
  }

  open(): void {
    if (!this.isOpen) {
      this.bar.hidden = false;
      pushLayer(this.layer);
    }
    const selected = window.getSelection()?.toString().trim();
    if (selected && !selected.includes("\n")) this.input.value = selected;
    this.input.focus();
    this.input.select();
    this.run(1, false);
  }

  close(): void {
    if (!this.isOpen) return;
    this.provider?.clear();
    this.provider = null;
    this.bar.hidden = true;
    removeLayer(this.layer);
    this.onClose();
  }

  /** Re-applies the search after the document was re-rendered or the tab changed. */
  refresh(): void {
    if (this.isOpen) this.run(1, false);
  }

  step(direction: 1 | -1): void {
    if (!this.isOpen) return this.open();
    this.run(direction, true);
  }

  private run(direction: 1 | -1, again: boolean): void {
    const found = this.getProvider();
    const provider = typeof found === "string" ? null : found;
    if (provider !== this.provider) {
      this.provider?.clear();
      this.provider = provider;
      again = false;
    }
    if (!provider) {
      this.count.textContent = typeof found === "string" ? found : "";
      return;
    }
    provider.onResult = ({ index, count }) => {
      this.count.textContent = this.input.value ? `${count ? index + 1 : 0}/${count}` : "";
    };
    provider.find(this.input.value, direction, again);
  }
}
