import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ingest", () => ({ processExternalEvent: vi.fn(), startExternalSource: vi.fn() }));
vi.mock("@/lib/ai/skills/server", () => ({ loadRoleInstructions: vi.fn() }));
const { bestPage, stakeholderScope } = await import("./stakeholderExternal");

describe("stakeholder pages as external knowledge", () => {
  const sources = [
    { title: "LinkedIn", url: "https://ca.linkedin.com/company/x" },
    { title: "Official", url: "https://www.epcor.com/about" },
    { title: "Wikipedia", url: "https://en.wikipedia.org/wiki/EPCOR_Utilities" },
  ];
  it("prefers the encyclopedia article, then the official site, then the first page", () => {
    expect(bestPage({ sources, website: "https://epcor.com" })?.title).toBe("Wikipedia");
    expect(bestPage({ sources: sources.slice(0, 2), website: "https://epcor.com" })?.title).toBe("Official");
    expect(bestPage({ sources: sources.slice(0, 2), website: null })?.title).toBe("LinkedIn");
    expect(bestPage({ sources: [], website: null })).toBeNull();
  });
  it("scopes the approval to the stakeholder's card", () => {
    expect(stakeholderScope("EPCOR")).toMatchObject({ article: "Stakeholder: EPCOR", section: "Overview" });
  });
});
