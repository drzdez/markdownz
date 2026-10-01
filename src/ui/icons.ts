/** Small inline SVG icons (currentColor), no icon font or emoji. */

export function folderIcon(): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute(
    "d",
    "M1.75 2.5h4.13c.46 0 .9.18 1.22.51l.97.99h6.18c.69 0 1.25.56 1.25 1.25v7.5c0 .69-.56 1.25-1.25 1.25H1.75C1.06 14 .5 13.44.5 12.75v-9C.5 3.06 1.06 2.5 1.75 2.5Zm0 1.5a.25.25 0 0 0-.25.25v8.5c0 .14.11.25.25.25h12.5c.14 0 .25-.11.25-.25v-7.5a.25.25 0 0 0-.25-.25H7.75L6.52 3.75a.25.25 0 0 0-.18-.08H1.75Z",
  );
  svg.append(path);
  return svg;
}
