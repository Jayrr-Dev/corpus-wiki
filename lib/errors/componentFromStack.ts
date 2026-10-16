// =====================================================================
// WHICH COMPONENT: the component an error happened in, read from a stack.
// A React component stack ("at SourceDetail (…)") names it directly; a
// plain stack trace is read for its first PascalCase function, which is
// the component in dev builds (minified names in production are skipped).
// Shared by the server log and its tests; no server-only imports.
// =====================================================================

// Names that look like components but are React or Next internals
const INTERNAL = new Set(["Error", "TypeError", "ReferenceError", "Object", "Array", "Promise", "Function", "Component", "Suspense", "Fragment", "ErrorBoundary", "ErrorBoundaryHandler", "InnerLayoutRouter", "OuterLayoutRouter", "RenderFromTemplateContext", "ScrollAndFocusHandler", "LoadingBoundary", "HTTPAccessFallbackBoundary", "RedirectBoundary", "RedirectErrorBoundary", "AppRouter", "Router", "HotReload", "ReactDevOverlay", "ServerRoot", "Root"]);

// The first frame's function name in V8 ("at Name (…)", "at async Name …") and Firefox / Safari ("Name@…")
const FRAME = /^\s*(?:at\s+(?:async\s+)?(?:new\s+)?([\w$.]+)|([\w$.]+)@)/;

export function componentFromStack(...stacks: (string | null | undefined)[]): string | null {
  for (const stack of stacks) {
    if (!stack) continue;
    for (const line of stack.split("\n")) {
      const match = FRAME.exec(line);
      const name = (match?.[1] ?? match?.[2])?.split(".").pop();
      if (name && name.length > 2 && /^[A-Z][A-Za-z0-9]*$/.test(name) && !INTERNAL.has(name)) return name;
    }
  }
  return null;
}
