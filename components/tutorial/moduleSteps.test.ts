import { describe, expect, it } from "vitest";
import { getModuleTutorial } from "./moduleSteps";

describe("module tutorial routing", () => {
  it.each(["/", "/glossary", "/graph", "/ask", "/upload", "/units", "/changes", "/decisions", "/exceptions", "/sources", "/entities", "/domains", "/workflow", "/roles", "/settings"])("provides a walkthrough for %s", (path) => {
    const tutorial = getModuleTutorial(path);
    expect(tutorial?.steps.length).toBeGreaterThanOrEqual(2);
    for (const step of tutorial!.steps) {
      expect(step.targetFor(path).tourId).toBeTruthy();
      expect(step.targetFor(path).hint).toBeTruthy();
    }
  });

  it.each(["units", "changes", "decisions", "sources", "entities"])("gives %s detail pages their own tutorial", (module) => {
    expect(getModuleTutorial(`/${module}/example`)?.id).not.toBe(getModuleTutorial(`/${module}`)?.id);
    expect(getModuleTutorial(`/${module}/example`)).not.toBeNull();
  });

  it("handles article pages and the legacy Ask route", () => {
    expect(getModuleTutorial("/p/example")?.id).toBe("page");
    expect(getModuleTutorial("/chatbot")).toBe(getModuleTutorial("/ask"));
  });

  it.each(["/login", "/unknown", "/settings/unknown"])("does not attach an unrelated tour to %s", (path) => {
    expect(getModuleTutorial(path)).toBeNull();
  });
});
