import { DOMParser } from "linkedom";

// Provider vectors may use any viewBox. Keep executable content and external resources out.
const elements = new Set("svg g defs path rect circle ellipse line polyline polygon text tspan title desc linearGradient radialGradient stop clipPath mask use metadata c2pa:manifest".split(" "));
const attributes = new Set("xmlns xmlns:xlink version viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points fill fill-rule clip-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray opacity fill-opacity stroke-opacity transform id offset stop-color stop-opacity font-size font-family font-weight text-anchor dominant-baseline dx dy gradientUnits gradientTransform clip-path clipPathUnits mask maskUnits maskContentUnits href xlink:href color preserveAspectRatio".split(" "));
export function validateVectorSvg(svg: string): string[] {
  if (svg.length > 4_000_000 || /<!DOCTYPE|<!ENTITY|<\?|&(?:#|[a-z])/i.test(svg)) return ["Unsupported SVG declarations, entities or size"];
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.localName !== "svg" || root.getAttribute("xmlns") !== "http://www.w3.org/2000/svg") return ["Invalid vector SVG root"];
  const box: number[] = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || box.some((n) => !Number.isFinite(n)) || box[2]! <= 0 || box[3]! <= 0) return ["Invalid vector viewBox"];
  const nodes = [root, ...root.querySelectorAll("*")];
  if (nodes.length > 50_000) return ["Vector is too complex"];
  const errors = new Set<string>();
  for (const el of nodes) {
    if (!elements.has(el.localName)) errors.add(`Forbidden vector element: ${el.localName}`);
    if (el.localName === "c2pa:manifest" && (el.children.length || !/^[a-zA-Z0-9+/=\s]*$/.test(el.textContent ?? ""))) errors.add("Invalid content credentials");
    for (const attr of [...el.attributes]) {
      if (attr.name === "style" && /^\s*display\s*:\s*block\s*;?\s*$/.test(attr.value)) continue;
      if (attr.name === "xmlns:c2pa" && attr.value === "http://c2pa.org/manifest") continue;
      if (!attributes.has(attr.name)) errors.add(`Forbidden vector attribute: ${attr.name}`);
      if (attr.name === "xmlns" || attr.name === "xmlns:xlink") continue;
      if (/(?:javascript:|data:|https?:|@import|expression\(|\/\/)/i.test(attr.value)) errors.add("External or executable vector reference");
      if ((attr.name === "href" || attr.name === "xlink:href") && !/^#[\w.-]+$/.test(attr.value)) errors.add("Vector reference must be local");
      if (/url\(/i.test(attr.value) && !/^url\(#[\w.-]+\)$/.test(attr.value)) errors.add("Vector paint must be local");
    }
  }
  return [...errors];
}
