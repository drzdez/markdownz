import { el, pushLayer, removeLayer, type Layer } from "./overlay";

export interface MenuItem {
  label: string;
  hint?: string;
  disabled?: boolean;
  action: () => void;
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
    const button = el("button", { disabled: !!item.disabled }, el("span", { textContent: item.label }));
    if (item.hint) button.append(el("kbd", { textContent: item.hint }));
    button.setAttribute("role", "menuitem");
    button.addEventListener("click", () => {
      layer.close();
      item.action();
    });
    menu.append(button);
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
