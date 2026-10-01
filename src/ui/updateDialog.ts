import { el, openModal } from "./overlay";

export interface UpdateOffer {
  current: string;
  version: string;
  notes?: string;
  /** "self": install in place; "manual": the package is managed elsewhere, offer the download page. */
  mode: "self" | "manual";
  install(onProgress: (fraction: number | null) => void): Promise<void>;
  openDownloadPage(): Promise<void>;
  skip(): void;
}

/** "Markdownz X is available" with Install now / Later / Skip this version. */
export function showUpdateDialog(offer: UpdateOffer): void {
  const progress = el("progress", { max: 1 });
  progress.hidden = true;
  const status = el("p", { className: "mdz-hint" });
  const install = el("button", { className: "primary", textContent: offer.mode === "self" ? "Install now" : "Open download page" });
  const later = el("button", { textContent: "Later" });
  const skip = el("button", { textContent: "Skip this version" });
  const body = el(
    "div",
    { className: "mdz-update" },
    el("p", { textContent: `Markdownz ${offer.version} is available. You have ${offer.current}.` }),
    ...(offer.notes ? [el("pre", { className: "mdz-update-notes", textContent: offer.notes })] : []),
    ...(offer.mode === "manual"
      ? [el("p", { className: "mdz-hint", textContent: "This installation is managed by its package (Flatpak, .deb or .rpm); update it there or download the new version." })]
      : []),
    progress,
    status,
    el("div", { className: "mdz-print-buttons" }, skip, el("span", { className: "spacer" }), later, install),
  );
  const layer = openModal("Update available", body);
  later.addEventListener("click", () => layer.close());
  skip.addEventListener("click", () => {
    offer.skip();
    layer.close();
  });
  install.addEventListener("click", async () => {
    if (offer.mode === "manual") {
      await offer.openDownloadPage();
      layer.close();
      return;
    }
    for (const b of [install, later, skip]) b.disabled = true;
    progress.hidden = false;
    status.textContent = "Downloading…";
    try {
      await offer.install((fraction) => {
        if (fraction === null) progress.removeAttribute("value");
        else progress.value = fraction;
        status.textContent = fraction === null ? "Downloading…" : `Downloading… ${Math.round(fraction * 100)} %`;
      });
      status.textContent = "Installing and restarting…";
    } catch (e) {
      status.textContent = `Update failed: ${e}`;
      for (const b of [install, later, skip]) b.disabled = false;
      progress.hidden = true;
    }
  });
}
