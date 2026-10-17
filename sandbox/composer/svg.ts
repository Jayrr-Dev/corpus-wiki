import { DOMParser } from "linkedom";

// Strict allowlist, rather than attempting to strip executable SVG after rendering it.
const elements = new Set("svg g defs linearGradient radialGradient stop path rect circle ellipse line polyline polygon text tspan title desc".split(" "));
const attributes = new Set("xmlns viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points fill stroke stroke-width stroke-linecap stroke-linejoin opacity fill-opacity stroke-opacity transform id offset stop-color stop-opacity font-size font-family font-weight text-anchor dominant-baseline dx dy gradientUnits gradientTransform".split(" "));
export function validateSvg(svg: string): string[] {
  if (/<!|<\?|&(?:#|[a-z])/i.test(svg)) return ["SVG declarations and entities are not allowed"];
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.localName !== "svg" || root.getAttribute("viewBox") !== "0 0 800 520") return ["SVG needs the 800 × 520 viewBox"];
  const problems: string[] = [];
  for (const el of [root, ...root.querySelectorAll("*")]) {
    if (!elements.has(el.localName)) problems.push(`Forbidden SVG element: ${el.localName}`);
    for (const attr of [...el.attributes]) {
      if (!attributes.has(attr.name) || /(?:javascript:|data:|https?:|@import|expression\()/i.test(attr.value) && attr.name !== "xmlns") problems.push(`Forbidden SVG attribute: ${attr.name}`);
      if (/url\(/i.test(attr.value) && !/^url\(#[\w-]+\)$/.test(attr.value)) problems.push("External SVG paint reference");
    }
    if (["text", "tspan"].includes(el.localName) && el.hasAttribute("font-size") && Number(el.getAttribute("font-size")) < 20) problems.push("Small label: below 20 SVG units");
  }
  return [...new Set(problems)];
}
