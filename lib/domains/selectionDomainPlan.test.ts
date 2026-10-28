import { expect, it } from "vitest";
import { roleForPurpose } from "@/lib/ai/roles";
import { nearbyDomainIds, resolveSelectionDomainPlan, selectionDomainEvidence, selectionGroupAction, selectionGroupLabel, selectionPlanHeadline, dropClaimFromPlan, moveClaimInPlan, type SelectionClaim } from "./selectionDomainPlan";

const paths = ["Work", "Work/Notes", "Work/Tools", "Home"];

function claim(n: number, domains: string[]): SelectionClaim {
  const suffix = n.toString(16).padStart(12, "0");
  return { ref: `C${n}`, id: `00000000-0000-4000-8000-${suffix}`, revisionId: `10000000-0000-4000-8000-${suffix}`, domains };
}

const notes = claim(1, ["Work/Notes"]);
const tools = claim(2, ["Work/Tools"]);

it("uses the domain decider model", () => {
  expect(roleForPurpose("selection_domain_plan")).toBe("domain_decider");
});

it("files one new domain under an existing parent", () => {
  const plan = resolveSelectionDomainPlan({
    reason: "These claims are one subject.",
    groups: [{ destinationPath: null, parentPath: "Work", name: "Welding", claimRefs: ["C1", "C2"], why: "Both claims are about welding." }],
  }, [notes, tools], paths);
  expect(plan.groups).toEqual([expect.objectContaining({ createsDomain: true, destinationPath: "Work/Welding", unitIds: [notes.id, tools.id] })]);
  expect(selectionPlanHeadline(plan.groups)).toBe("One new domain");
  expect(selectionGroupAction(plan.groups[0]!, [notes.domains, tools.domains])).toBe("create");
  expect(selectionGroupLabel(plan.groups[0]!, [notes.domains, tools.domains])).toBe("New domain: Work/Welding");
});

it("moves claims into a domain that already fits", () => {
  const plan = resolveSelectionDomainPlan({
    reason: "Tools already covers this.",
    groups: [{ destinationPath: "Work/Tools", parentPath: null, name: null, claimRefs: ["C1"], why: "This is a tool claim." }],
  }, [notes], paths);
  expect(plan.groups[0]?.createsDomain).toBe(false);
  expect(selectionGroupAction(plan.groups[0]!, [notes.domains])).toBe("move");
  expect(selectionPlanHeadline(plan.groups)).toBe("Move into a domain that already exists");
});

it("splits a selection and keeps claims that are already home", () => {
  const plan = resolveSelectionDomainPlan({
    reason: "Two subjects.",
    groups: [
      { destinationPath: null, parentPath: "Work", name: "Welding", claimRefs: ["C1"], why: "Welding has no domain yet." },
      { destinationPath: "Work/Tools", parentPath: null, name: null, claimRefs: ["C2"], why: "Already a tool." },
    ],
  }, [notes, tools], paths);
  expect(selectionPlanHeadline(plan.groups)).toBe("Split across more than one domain");
  expect(selectionGroupAction(plan.groups[1]!, [tools.domains])).toBe("keep");
  expect(selectionGroupLabel(plan.groups[1]!, [tools.domains])).toBe("Keep in Work/Tools");
  const moved = moveClaimInPlan(plan, notes.id, "Work/Tools");
  expect(moved.groups.map((group) => group.destinationPath)).toEqual(["Work/Tools"]);
  expect(moved.groups[0]?.unitIds).toEqual([tools.id, notes.id]);
  const dropped = dropClaimFromPlan(plan, notes.id);
  expect(dropped.claims.map((claim) => claim.id)).toEqual([tools.id]);
  expect(dropped.groups.map((group) => group.destinationPath)).toEqual(["Work/Tools"]);
});

it("folds repeated destinations into one group", () => {
  const plan = resolveSelectionDomainPlan({
    reason: "Same home.",
    groups: [
      { destinationPath: "Work/Tools", parentPath: null, name: null, claimRefs: ["C1"], why: "A tool." },
      { destinationPath: "Work/Tools", parentPath: null, name: null, claimRefs: ["C2"], why: "Also a tool." },
    ],
  }, [notes, tools], paths);
  expect(plan.groups).toHaveLength(1);
  expect(plan.groups[0]?.unitIds).toEqual([notes.id, tools.id]);
});

it("rejects a missing claim, a cross-root move, a catch-all, and a no-op", () => {
  const base = { destinationPath: null, parentPath: "Work", name: "Welding", claimRefs: ["C1"], why: "One subject." };
  expect(() => resolveSelectionDomainPlan({ reason: "Missing", groups: [{ ...base, claimRefs: ["C1", "C9"] }] }, [notes], paths)).toThrow("Unknown claim");
  expect(() => resolveSelectionDomainPlan({ reason: "Root", groups: [{ destinationPath: "Home", parentPath: null, name: null, claimRefs: ["C1"], why: "Wrong tree." }] }, [notes], paths)).toThrow("cannot move");
  expect(() => resolveSelectionDomainPlan({ reason: "Catch", groups: [{ ...base, name: "Notes" }] }, [notes], paths)).toThrow("catch-all");
  expect(() => resolveSelectionDomainPlan({ reason: "Same", groups: [{ destinationPath: "Work/Notes", parentPath: null, name: null, claimRefs: ["C1"], why: "Already there." }] }, [notes], paths)).toThrow("already filed");
});

it("samples the selected branch and clips long claim text", () => {
  expect(nearbyDomainIds([
    { id: "work", parentId: null },
    { id: "notes", parentId: "work" },
    { id: "tools", parentId: "work" },
    { id: "bits", parentId: "tools" },
    { id: "home", parentId: null },
  ], ["notes"])).toEqual(["notes", "work", "tools"]);
  const crowded = [
    { id: "parent", parentId: null },
    ...Array.from({ length: 45 }, (_, index) => ({ id: `sibling-${index}`, parentId: "parent" })),
    { id: "selected", parentId: "parent" },
    { id: "child", parentId: "selected" },
  ];
  const nearby = nearbyDomainIds(crowded, ["selected"]);
  expect(nearby.slice(0, 2)).toEqual(["selected", "child"]);
  expect(nearby).toHaveLength(40);
  const evidence = selectionDomainEvidence({
    claims: [{ ref: "C1", content: "x".repeat(900), domains: ["Work/Notes"] }],
    domains: [
      { path: "Work", parentPath: null, example: "y".repeat(200) },
      { path: "Work/Notes", parentPath: "Work" },
      { path: "Work/Notes/Type Four", parentPath: "Work/Notes" },
      { path: "Home", parentPath: null },
    ],
  });
  expect(evidence.selected[0]?.content.endsWith("…")).toBe(true);
  expect(evidence.selected[0]?.content.length).toBe(801);
  expect(evidence.selected[0]).toMatchObject({ childDomains: ["Work/Notes/Type Four"] });
  expect(evidence.domains[0]?.path).toBe("Home");
  expect(evidence.domains[1]).toMatchObject({ path: "Work", example: expect.stringMatching(/…$/) });
  expect(evidence.domains[0]).not.toHaveProperty("example");
});
