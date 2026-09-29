import mdLight from "github-markdown-css/github-markdown-light.css?inline";
import mdDark from "github-markdown-css/github-markdown-dark.css?inline";
import hlLight from "highlight.js/styles/github.css?inline";
import hlDark from "highlight.js/styles/github-dark.css?inline";
import type { ThemeSetting } from "../state";

const media = matchMedia("(prefers-color-scheme: dark)");
const style = document.createElement("style");
document.head.prepend(style);

let setting: ThemeSetting = "auto";
let listener: ((theme: "light" | "dark") => void) | undefined;

export function effectiveTheme(): "light" | "dark" {
  if (setting === "auto") return media.matches ? "dark" : "light";
  return setting;
}

function apply(): void {
  const theme = effectiveTheme();
  document.documentElement.dataset.theme = theme;
  style.textContent = theme === "dark" ? mdDark + hlDark : mdLight + hlLight;
}

/** Applies the theme now; `onChange` fires whenever the effective theme changes later. */
export function initTheme(value: ThemeSetting, onChange: (theme: "light" | "dark") => void): void {
  setting = value;
  listener = onChange;
  apply();
  media.addEventListener("change", () => {
    if (setting !== "auto") return;
    apply();
    listener?.(effectiveTheme());
  });
}

export function setTheme(value: ThemeSetting): void {
  const before = effectiveTheme();
  setting = value;
  apply();
  if (effectiveTheme() !== before) listener?.(effectiveTheme());
}
