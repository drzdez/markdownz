// Stack of closable UI layers (dialogs, find bar, diagram viewer).
// Escape always closes the topmost layer first; only with no layers open
// does it close the window.

export interface Layer {
  close(): void;
  /** Return true when the key was handled and should not reach global shortcuts. */
  onKey?(e: KeyboardEvent): boolean;
}

const stack: Layer[] = [];

export function pushLayer(layer: Layer): void {
  stack.push(layer);
}

export function removeLayer(layer: Layer): void {
  const i = stack.indexOf(layer);
  if (i >= 0) stack.splice(i, 1);
}

export function topLayer(): Layer | undefined {
  return stack[stack.length - 1];
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** Moves focus between `[data-nav]` elements with arrow keys. */
function arrowNav(root: HTMLElement, e: KeyboardEvent): boolean {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return false;
  const items = [...root.querySelectorAll<HTMLElement>("[data-nav]")];
  if (!items.length) return false;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = e.key === "ArrowDown" ? Math.min(i + 1, items.length - 1) : Math.max(i - 1, 0);
  items[i < 0 ? 0 : next].focus();
  return true;
}

export interface ModalOptions {
  className?: string;
  onKey?(e: KeyboardEvent, close: () => void): boolean;
  onClose?(): void;
}

export function openModal(title: string, body: HTMLElement, options: ModalOptions = {}): Layer {
  const previousFocus = document.activeElement as HTMLElement | null;
  const modal = el("div", { className: `mdz-modal ${options.className ?? ""}` }, el("h2", { textContent: title }), body);
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-label", title);
  const backdrop = el("div", { className: "mdz-backdrop" }, modal);

  const layer: Layer = {
    close() {
      backdrop.remove();
      removeLayer(layer);
      options.onClose?.();
      previousFocus?.focus({ preventScroll: true });
    },
    onKey(e) {
      if (options.onKey?.(e, layer.close)) return true;
      if (arrowNav(modal, e)) return true;
      // Swallow everything else except Tab/Enter/Space so global shortcuts stay inactive.
      return !["Tab", "Enter", " "].includes(e.key);
    },
  };
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) layer.close();
  });
  document.body.append(backdrop);
  pushLayer(layer);
  (modal.querySelector<HTMLElement>("[autofocus], [data-nav], input, button") ?? modal).focus();
  return layer;
}
