import type { GraphColor } from "@/lib/graph";

// =====================================================================
// CANVAS PALETTE: canvas cannot read Tailwind classes, so the colors
// are resolved from the same CSS tokens in app/globals.css at draw time.
// Reading them per frame keeps the graph in step with a theme switch.
// =====================================================================

export interface CanvasPalette {
  background: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  // The page's font stack (canvas fonts cannot use var())
  fontFamily: string;
  // Any group color by token name
  token: (color: GraphColor) => string;
}

// Reads the current token values from the element's computed style
export function readCanvasPalette(element: Element): CanvasPalette {
  const style = getComputedStyle(element);
  const colors = new Map<string, string>();
  const token = (name: string) => {
    let value = colors.get(name);
    if (value === undefined) {
      value = style.getPropertyValue(`--sb-${name}`).trim();
      colors.set(name, value);
    }
    return value;
  };
  return {
    background: token("background"),
    border: token("border"),
    text: token("text"),
    muted: token("muted"),
    faint: token("faint"),
    fontFamily: style.fontFamily,
    token,
  };
}
