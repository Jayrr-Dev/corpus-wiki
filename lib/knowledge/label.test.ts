import { describe, expect, it } from "vitest";
import { knowledgeLabel } from "./label";
describe("short knowledge labels", () => {
  it.each([
    ["Utilitek Solutions Inc. requires a Job Hazard Analysis before work.", "Job Hazard Analysis"],
    ["The company will develop a Hearing Conservation Program for exposed workers.", "Hearing Conservation Program"],
    ["Utilitek Solutions Inc. PPE is categorized as basic and specialized.", "PPE categories"],
    ["Utilitek Solutions Inc. requires all employees to immediately report all accidents.", "Incident reporting"],
    ["Utilitek Solutions Inc. supervisors are held accountable for worker safety.", "Worker safety responsibilities"],
    ["The company provides a modified work program for injured employees.", "Modified work program"],
    ["The company holds regular safety meetings every week.", "Safety meetings"],
    ["The company uses a hazard control hierarchy of elimination and personal protective equipment.", "Hazard control hierarchy"],
    ["", "Untitled knowledge"],
  ])("labels %s", (text, expected) => expect(knowledgeLabel(text)).toBe(expected));
  it("uses actual subject metadata and bounds fallback length", () => {
    expect(knowledgeLabel("Long narrative", {subject:"Incident reporting"})).toBe("Incident reporting");
    expect(knowledgeLabel("Long narrative", {subject:"Return to Work / Modified Duties"})).toBe("Return to Work");
    expect(knowledgeLabel("A very long arbitrary sentence explaining several unrelated topics for many people").split(" ").length).toBeLessThanOrEqual(5);
  });
});
