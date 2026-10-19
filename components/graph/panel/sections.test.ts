import React, { type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DomainTreeSelect } from "@/components/actions/DomainTreeSelect";
import { DEFAULT_GRAPH_SETTINGS, type GraphFilters, type GraphNode } from "@/lib/graph";
import { DomainsSection } from "./sections";

vi.stubGlobal("React", React);
const picker = vi.hoisted(() => vi.fn());
vi.mock("@/components/actions/DomainTreeSelect", () => ({ DomainTreeSelect: (props: unknown) => { picker(props); return null; } }));
vi.mock("./PanelSection", () => ({ PanelSection: ({ children }: { children: ReactNode }) => children }));

const nodes: GraphNode[] = [{
  id: "unit", kind: "unit", domainPaths: ["Work/Plans", "Research/Ideas"],
  label: "Plans", text: "Plans", href: "/units/unit", createdAt: "2026-10-18T00:00:00Z", degree: 0,
  domainScopePaths: { internal: ["Work/Plans"], external: ["Research/Ideas"] },
  entityNames: [], unitKind: "fact", status: "established",
}];

function renderPicker(domainScope: GraphFilters["domainScope"]) {
  const onChange = vi.fn();
  renderToStaticMarkup(React.createElement(DomainsSection, {
    nodes, value: { ...DEFAULT_GRAPH_SETTINGS.filters, domainScope }, onChange,
  }));
  const props = picker.mock.lastCall![0] as ComponentProps<typeof DomainTreeSelect>;
  return { props, onChange };
}

describe("graph domain picker", () => {
  it.each(["none", "internal", "external", "both"] as const)("keeps both domain trees available when visibility is %s", (scope) => {
    const { props } = renderPicker(scope);
    expect(props.groups?.map((group) => group.domains.map((domain) => domain.path))).toEqual([
      ["Work", "Work/Plans"], ["Research", "Research/Ideas"],
    ]);
    expect(props.domains).toHaveLength(4);
  });

  it.each([
    ["none", "internal", "Work/Plans", "internal"],
    ["none", "external", "Research/Ideas", "external"],
    ["internal", "external", "Research/Ideas", "both"],
    ["external", "internal", "Work/Plans", "both"],
    ["both", "internal", "Work/Plans", "both"],
  ] as const)("enables a selected %s → %s domain", (current, group, domain, expected) => {
    const { props, onChange } = renderPicker(current);
    props.onChange(domain, group);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ domain, domainScope: expected }));
  });

  it("restores domain visibility when choosing All domains with both switches off", () => {
    const { props, onChange } = renderPicker("none");
    props.onChange("");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ domain: "", domainScope: "both" }));
  });
});
