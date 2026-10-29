// The signed-in home; / is the public landing page
export const APP_HOME = "/pages";

// Accept only local paths, including when a URL parser normalizes backslashes.
// Signing in never ends on the landing page.
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || value === "/" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000- ]/.test(value)) return APP_HOME;
  return value;
}
