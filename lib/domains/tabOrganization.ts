import { z } from "zod";
import type { DecisionSnapshot } from "./decider";

export const TAB_FILING_RULES = `Domain tabs are navigation groups, not evidence of authority, provenance, confidentiality or organizational ownership. A tab name or description never makes a claim internal policy or external guidance. Determine ownership from the source and claim evidence; an organization mentioned in an external source is not automatically its owner. Reuse the correct existing root regardless of its tab. Do not create competing internal/external roots for the same subject merely to match tabs. Preserve source attribution and distinguish externally recommended practices from an organization's adopted practices. A domain may contain both when clearly attributed; do not imply adoption without evidence.`;

export const tabPlanSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
  tabs: z.array(z.object({
    id: z.uuid().nullable(),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(2000),
    rootIds: z.array(z.uuid()),
  })).min(1).max(40),
});
export type TabPlan = z.infer<typeof tabPlanSchema>;
export type TabLayout = {
  tabs: { id: string; name: string; description: string; root_ids: string[] }[];
  roots: { id: string; name: string; path: string; context_entity_id: string | null }[];
};

export function validateTabPlan(plan: TabPlan, layout: TabLayout) {
  const ids = new Set<string>(), names = new Set<string>(), roots = new Set<string>();
  for (const tab of plan.tabs) {
    const existing = layout.tabs.find(t => t.id === tab.id);
    if (tab.id && (!existing || ids.has(tab.id))) throw new Error("Unknown or repeated tab. Generate a new suggestion.");
    if (existing && (existing.name !== tab.name || existing.description !== tab.description)) throw new Error("Keep existing tab names and descriptions unchanged.");
    if (tab.id) ids.add(tab.id);
    const key = tab.name.toLowerCase();
    if (names.has(key)) throw new Error("Tab names must be unique.");
    names.add(key);
    if (!tab.id && !tab.rootIds.length) throw new Error("A new tab must contain a root domain.");
    for (const id of tab.rootIds) {
      if (!layout.roots.some(r => r.id === id) || roots.has(id)) throw new Error("Each active root must appear in exactly one tab.");
      roots.add(id);
    }
  }
  if (layout.tabs.some(t => !ids.has(t.id)) || roots.size !== layout.roots.length) throw new Error("Keep all existing tabs and include every active root exactly once.");
}

// Balanced examples across branches keep a large book from dominating the prompt.
// Paths provide subject breadth; full saved claim text supplies semantic evidence.
export function tabOrganizationEvidence(layout: TabLayout, snapshot: DecisionSnapshot) {
  const live = new Map(snapshot.claims.filter(c => !c.retiredAt).map(c => [c.id, c.content]));
  const memberships = new Map<string, string[]>();
  for (const row of snapshot.unitDomains) {
    const content = live.get(row.unit_id);
    if (content) {
      const examples = memberships.get(row.domain_id) ?? [];
      // Only three examples per branch are sent; avoid accumulating large books.
      if (examples.length < 3) examples.push(content);
      memberships.set(row.domain_id, examples);
    }
  }
  return { tabs: layout.tabs, roots: layout.roots.map(root => {
    const branches = snapshot.domains.filter(d => !d.retired_at && (d.path === root.path || d.path.startsWith(root.path + "/")));
    const samples: { path: string; content: string }[] = [];
    for (let i = 0; i < 3 && samples.length < 18; i++) {
      for (const branch of branches) {
        const content = memberships.get(branch.id)?.[i];
        if (content && samples.length < 18) samples.push({ path: branch.path, content });
      }
    }
    return { ...root, branches: branches.map(d => d.path), samples };
  }) };
}
