import { el, pushLayer, removeLayer, type Layer } from "./overlay";

export interface MenuItem {
  label: string;
  hint?: string;
  /** Second, muted line (e.g. a path). */
  detail?: string;
  disabled?: boolean;
  className?: string;
  /** Identifies the item for the visible keys passed to actions. */
  key?: string;
  /** Receives the keys of the items that were visible in the (scrollable) menu when clicked. */
  action: (visibleKeys: string[]) => void;
  /** Small icon button next to the item (e.g. "show in folder"). */
  side?: { icon: SVGElement; title: string; action: () => void };
}

/** Keys (data-key) of the children of `container` that are at least partly visible in it. */
export function visibleKeys(container: HTMLElement): string[] {
  const box = container.getBoundingClientRect();
  return [...container.querySelectorAll<HTMLElement>("[data-key]")]
    .filter((item) => {
      const r = item.getBoundingClientRect();
      return r.bottom > box.top && r.top < box.bottom && r.height > 0;
    })
    .map((item) => item.dataset.key!);
}

/** Small popup menu at (x, y); `null` entries render as separators. */
export function showContextMenu(x: number, y: number, items: (MenuItem | null)[]): void {
  const menu = el("div", { className: "mdz-menu" });
  menu.setAttribute("role", "menu");

  const layer: Layer = {
    close() {
      menu.remove();
      removeLayer(layer);
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", layer.close);
    },
    onKey(e) {
      const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "ArrowDown") buttons[(i + 1) % buttons.length]?.focus();
      else if (e.key === "ArrowUp") buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
      else if (e.key === "Enter" || e.key === " ") (document.activeElement as HTMLElement | null)?.click();
      return true;
    },
  };
  const outside = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) layer.close();
  };

  for (const item of items) {
    if (!item) {
      menu.append(el("hr"));
      continue;
    }
    const text = el("span", { className: "mdz-menu-text" }, el("span", { textContent: item.label }));
    if (item.detail) text.append(el("small", { textContent: item.detail }));
    const button = el("button", { disabled: !!item.disabled, className: item.className ?? "" }, text);
    if (item.hint) button.append(el("kbd", { textContent: item.hint }));
    if (item.key) button.dataset.key = item.key;
    button.setAttribute("role", "menuitem");
    button.addEventListener("click", () => {
      const visible = visibleKeys(menu);
      layer.close();
      item.action(visible);
    });
    if (!item.side) {
      menu.append(button);
      continue;
    }
    const side = el("button", { className: "mdz-menu-side", title: item.side.title }, item.side.icon);
    side.setAttribute("aria-label", item.side.title);
    const sideAction = item.side.action;
    side.addEventListener("click", () => {
      layer.close();
      sideAction();
    });
    const row = el("div", { className: "mdz-menu-row" }, button, side);
    if (item.key) row.dataset.key = item.key;
    button.removeAttribute("data-key");
    menu.append(row);
  }

  document.body.append(menu);
  // Keep the menu inside the window.
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 4)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 4)}px`;
  pushLayer(layer);
  window.addEventListener("pointerdown", outside, true);
  window.addEventListener("blur", layer.close);
  menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}
