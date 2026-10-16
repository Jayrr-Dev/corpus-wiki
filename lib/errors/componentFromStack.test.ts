import { describe, expect, it } from "vitest";
import { componentFromStack } from "./componentFromStack";

describe("componentFromStack", () => {
  it("names the first component in a V8 stack trace", () => {
    const stack = "ReferenceError: useSourceArticles is not defined\n    at SourceDetail (http://localhost:3000/_next/static/chunks/app_abc.js:120:5)\n    at renderWithHooks (http://localhost:3000/_next/static/chunks/react-dom.js:1:1)";
    expect(componentFromStack(stack)).toBe("SourceDetail");
  });

  it("prefers the React component stack and skips framework boundaries", () => {
    const componentStack = "\n    at ImageViewer (http://localhost:3000/x.js:1:1)\n    at ErrorBoundary (http://localhost:3000/y.js:1:1)";
    expect(componentFromStack(componentStack, "Error: x\n    at Object.render (z.js:1:1)")).toBe("ImageViewer");
  });

  it("reads Firefox frames and ignores minified or lowercase names", () => {
    expect(componentFromStack("t@http://x/a.js:1:1\nuseThing@http://x/b.js:1:1\nWikiPageView@http://x/c.js:1:1")).toBe("WikiPageView");
    expect(componentFromStack("Error\n    at e (a.js:1:1)\n    at Gt (a.js:1:1)")).toBeNull();
    expect(componentFromStack(null, undefined)).toBeNull();
  });
});
