import { describe, expect, it } from "vitest";
import { actorLabel, describeActionInput, modelName, readablePassage } from "./format";

describe("actorLabel", () => {
  it("names a person, or says Person when the name is unknown", () => {
    expect(actorLabel("person", "Sam", null)).toBe("Sam");
    expect(actorLabel("person", null, "zai-org/GLM-5.3-Flash")).toBe("Person");
  });

  it("names the AI's model, or says AI when it is unknown", () => {
    expect(actorLabel("ai", "Sam", "zai-org/GLM-5.3-Flash")).toBe("AI · GLM-5.3-Flash");
    expect(actorLabel("ai", null, null)).toBe("AI");
  });
});

describe("modelName", () => {
  it("drops the vendor prefix", () => {
    expect(modelName("meta-llama/Llama-3.3-70B-Instruct")).toBe("Llama-3.3-70B-Instruct");
    expect(modelName("gpt-x")).toBe("gpt-x");
  });
});

describe("readablePassage", () => {
  it("turns table-of-contents dot leaders into one entry per line", () => {
    const text = "Section 1 Health & Safety Policy ............ 5 Section 2 Roles &\nResponsibilities ........ 6\nEmployer.........\n6 Supervisor/Foreman\n..........";
    expect(readablePassage(text)).toBe("Section 1 Health & Safety Policy … 5\nSection 2 Roles & Responsibilities … 6\nEmployer … 6\nSupervisor/Foreman …");
  });

  it("joins wrapped lines but keeps paragraphs, list items and real ellipses", () => {
    expect(readablePassage("The worker must\nreport hazards...\n\nNext paragraph\n- first\n- second")).toBe("The worker must report hazards...\n\nNext paragraph\n- first\n- second");
  });

  it("starts each inline bullet on its own line", () => {
    expect(readablePassage("Workers shall: ▪ Comply with the program; ▪ Wear PPE")).toBe("Workers shall:\n▪ Comply with the program;\n▪ Wear PPE");
  });
});

describe("Curator changes", () => {
  const curator = (input: Record<string, unknown>) => describeActionInput("update_page", { curator: true, confident: true, reason: "r", ...input } as never);
  it("names the pages a change touches", () => {
    expect(curator({ operation: "group", title: "Quality management", articleType: "concept", parentPageId: null, pageIds: ["a", "b"], titles: { page: "Quality inspection", pages: ["Quality inspection", "Sampling"] } }))
      .toBe("Create a new concept page, “Quality management”, at the top level, and file “Quality inspection”, “Sampling” under it. The Planner writes its overview from those pages.");
    expect(curator({ operation: "merge", intoPageId: "b", sectionTitle: "Fees", unitIds: ["1", "2"], titles: { page: "Permit fees", into: "Permits" } }))
      .toBe("Merge “Permit fees” into “Permits” and retire “Permit fees”. Its 2 claim(s) not already there become a new section, “Fees”. Pages under it move with it.");
    expect(curator({ operation: "move", parentPageId: "p", titles: { page: "ULA", parent: "City of Edmonton" } })).toBe("Move “ULA” under “City of Edmonton”.");
    expect(curator({ operation: "rename", title: "Workplace Hazardous Materials Information System (WHMIS)", titles: { page: "WHMIS" } })).toBe("Rename “WHMIS” to “Workplace Hazardous Materials Information System (WHMIS)”.");
  });
  it("still reads for proposals saved before titles were", () => {
    expect(curator({ operation: "move", parentPageId: null })).toBe("Move this page to the top level.");
    expect(describeActionInput("update_page", { reason: "Not the Curator's" })).toBe("Not the Curator's");
  });
});
