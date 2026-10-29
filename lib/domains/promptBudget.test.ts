import { expect, it } from "vitest";
import { estimatePromptTokens, scopeNeighbors, topicPromptBudgetOn } from "./promptBudget";

it("is on unless TOPIC_PROMPT_BUDGET is off", () => {
  expect(topicPromptBudgetOn({})).toBe(true);
  expect(topicPromptBudgetOn({ TOPIC_PROMPT_BUDGET: "on" })).toBe(true);
  expect(topicPromptBudgetOn({ TOPIC_PROMPT_BUDGET: "off" })).toBe(false);
});

it("estimates tokens on the safe side of the measured 2.45 characters per token", () => {
  expect(estimatePromptTokens([{ role: "system", content: "x".repeat(300) }, { role: "user", content: "y".repeat(300) }])).toBe(250);
});

it("keeps only the batch's own neighbors and points profile examples at them", () => {
  const neighbors = ["E1", "E2", "E3", "E4"].map(ref => ({ ref, content: `text ${ref}`, domains: ["A"] }));
  const scoped = scopeNeighbors(new Set(["C1"]), {
    neighbors,
    candidates: [{ ref: "C1", neighbors: [{ ref: "E1" }] }, { ref: "C2", neighbors: [{ ref: "E2" }] }],
    links: [{ from: "E3", to: "C1" }, { from: "C2", to: "E4" }],
    domainProfiles: [
      { path: "A", totalClaims: 9, examples: neighbors.map(n => ({ ref: n.ref, content: n.content })) },
      { path: "B", totalClaims: 2, examples: [{ ref: "E2", content: "text E2" }] },
    ],
  });
  expect(scoped.neighbors.map(n => n.ref)).toEqual(["E1", "E3"]);
  expect(scoped.profiles).toEqual([{ path: "A", totalClaims: 9, exampleRefs: ["E1", "E3"] }]);
});
