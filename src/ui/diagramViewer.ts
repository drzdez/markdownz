import { el, pushLayer, removeLayer, type Layer } from "./overlay";

/** Full-window view of one diagram with wheel zoom and drag panning. */
export function openDiagram(figure: HTMLElement): void {
  const svg = figure.querySelector("svg");
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("style");
  clone.removeAttribute("width");
  clone.removeAttribute("height");

  const stage = el("div", { className: "mdz-diagram-stage" });
  stage.append(clone);
  const hint = el("div", { className: "mdz-diagram-hint", textContent: "Wheel: zoom · drag: pan · 0: reset · Esc: close" });
  const root = el("div", { className: "mdz-diagram-viewer" }, stage, hint);

  let scale = 1;
  let x = 0;
  let y = 0;
  const apply = () => (stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`);
  const reset = () => {
    scale = 1;
    x = 0;
    y = 0;
    apply();
  };
  const zoomAt = (factor: number, cx: number, cy: number) => {
    const next = Math.min(20, Math.max(0.1, scale * factor));
    const rect = root.getBoundingClientRect();
    // Keep the point under the cursor fixed.
    const px = cx - rect.left - rect.width / 2;
    const py = cy - rect.top - rect.height / 2;
    x = px - ((px - x) * next) / scale;
    y = py - ((py - y) * next) / scale;
    scale = next;
    apply();
  };

  root.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    },
    { passive: false },
  );
  root.addEventListener("pointerdown", (e) => {
    const startX = e.clientX - x;
    const startY = e.clientY - y;
    root.setPointerCapture(e.pointerId);
    root.classList.add("dragging");
    const move = (ev: PointerEvent) => {
      x = ev.clientX - startX;
      y = ev.clientY - startY;
      apply();
    };
    const up = () => {
      root.removeEventListener("pointermove", move);
      root.classList.remove("dragging");
    };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up, { once: true });
  });
  root.addEventListener("dblclick", reset);

  const layer: Layer = {
    close() {
      root.remove();
      removeLayer(layer);
    },
    onKey(e) {
      const rect = root.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      if (e.key === "+" || e.key === "=") zoomAt(1.25, cx, cy);
      else if (e.key === "-") zoomAt(0.8, cx, cy);
      else if (e.key === "0") reset();
      return true;
    },
  };
  document.body.append(root);
  pushLayer(layer);
}
