import { describe, expect, it } from "vitest";
import { actorLabel, modelName, readablePassage } from "./format";

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
