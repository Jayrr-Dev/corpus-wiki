import { describe, expect, it, vi } from "vitest";
import { assertStyleCoverage, refreshSectionStyle, styleRefreshState } from "./refreshStyle";
import type { SectionState } from "./types";
import { AiInactivityError } from "@/lib/ai/inactivityTimeout";

const state: SectionState = {
  sectionId: "s", title: "Overview", pageTitle: "ExampleCo", units: [
    { unitId: "a", revisionId: "ra", content: "Protection is required at 85 dB.", kind: "fact", epistemicStatus: "supported" },
    { unitId: "b", revisionId: "rb", content: "The program is planned.", kind: "fact", epistemicStatus: "supported" },
  ], lines: [
    { lineId: "generated", lineRevisionId: "lg", position: 0, content: "Generated text", author: "ai", unitIds: ["a"], needsRewrite: false },
    { lineId: "manual", lineRevisionId: "lm", position: 1, content: "Handwritten text", author: "person", unitIds: ["b"], needsRewrite: true },
  ],
};
const input = () => ({ ...styleRefreshState(state), sectionTitle: state.title, uncoveredUnitIds: [] });
describe("explicit article style refresh", () => {
  it("flags generated prose while preserving handwritten text and original state", () => {
    expect(styleRefreshState(state).lines.map((line) => line.needsRewrite)).toEqual([true, false]);
    expect(state.lines[0]?.needsRewrite).toBe(false);
    expect(state.lines[1]?.needsRewrite).toBe(true);
  });
  it("accepts changed wording without losing the claim covered by a manual line", () => {
    expect(() => assertStyleCoverage(input(), { modelVersion:"test", revise:[{lineId:"generated",text:"Protection is mandatory at 85 dB.",unitIds:["a"]}], retire:[],add:[] })).not.toThrow();
  });
  it("rejects a rewrite that drops a claim before anything is committed", () => {
    expect(() => assertStyleCoverage(input(), { modelVersion:"test", revise:[], retire:["generated"],add:[] })).toThrow("omitted 1 claims");
  });
  it("allows reviewed editorial omissions while retaining coverage for substantive facts", () => {
    expect(() => assertStyleCoverage(input(), { modelVersion: "test", revise: [], retire: ["generated"], add: [], omittedUnitIds: ["a"] })).not.toThrow();
    expect(() => assertStyleCoverage(input(), { modelVersion: "test", revise: [], retire: ["generated"], add: [], omittedUnitIds: ["unrelated"] })).toThrow("omitted 1 claims");
  });
  it("does not count invented citations or attempted edits to a protected line", () => {
    expect(() => assertStyleCoverage(input(), { modelVersion:"test", revise:[{lineId:"manual",text:"Replacement",unitIds:["a","b"]}], retire:["generated"],add:[] })).toThrow("omitted 1 claims");
  });
});


describe("user-triggered section update", () => {
  it("releases a section after AI inactivity without saving partial output", async () => {
    const call = vi.fn(async (fn: string) => {
      if (fn === "claim_section_build") return { claimed: true };
      if (fn === "read_section_state") return state;
      return {};
    });
    await expect(refreshSectionStyle({ call: call as import("@/lib/db/rpc").DbRpc["call"] }, {
      name: "test", reviseSection: async () => { throw new AiInactivityError(); },
    }, "s")).rejects.toThrow("no new output for 60 seconds");
    expect(call.mock.calls.map(([name]) => name)).toContain("mark_section_stale");
    expect(call.mock.calls.map(([name]) => name)).not.toContain("submit_change_set");
    expect(call.mock.calls.map(([name]) => name)).not.toContain("finish_section_build");
  });
  it("reloads current claims, forwards the note, rewrites AI text and includes new claims", async () => {
    const latest = { ...state, units: [...state.units, { ...state.units[0]!, unitId: "new", revisionId: "rnew", content: "Newly saved knowledge." }] };
    const call = vi.fn(async (fn: string) => {
      if (fn === "claim_section_build") return { claimed: true };
      if (fn === "read_section_state") return latest;
      if (fn === "read_section_article_structure") return { current: [{ title: "Current heading", position: 0, unitIds: ["a", "new"] }], planned: null,
        applied: { status: "applied", outOfDate: true, rationale: "Start with context, then explain the process.", structure: [{ title: "Saved heading", position: 0, unitIds: ["a"] }] } };
      if (fn === "submit_change_set") return { changeSetId: "change", eventId: "event" };
      if (fn === "commit_change_set") return { status: "applied", applied: 2 };
      return {};
    });
    const reviseSection = vi.fn(async () => ({ modelVersion: "current-model", revise: [{ lineId: "generated", text: "Updated wording", unitIds: ["a"] }], retire: [], add: [{ text: "Newly saved knowledge.", unitIds: ["new"] }] }));
    await refreshSectionStyle({ call: call as import("@/lib/db/rpc").DbRpc["call"] }, { name: "test", promptVersion: "skill-v3", reviseSection }, "s", "Keep it concise.");
    expect(reviseSection).toHaveBeenCalledWith(expect.objectContaining({ updateNote: "Keep it concise.", uncoveredUnitIds: ["new"], units: latest.units, lines: expect.arrayContaining([expect.objectContaining({ lineId: "manual", needsRewrite: false }), expect.objectContaining({ lineId: "generated", needsRewrite: true })]) }));
    expect(reviseSection).toHaveBeenCalledWith(expect.objectContaining({ articleStructure: expect.objectContaining({ outOfDate: true, currentSectionTitles: ["Current heading"], sections: [{ title: "Saved heading", position: 0, claimCount: 1 }] }) }));
    expect(call.mock.calls.map(([name]) => name)).toEqual(["resume_section_build", "claim_section_build", "read_section_state", "read_page_context", "read_section_article_structure", "submit_change_set", "commit_change_set", "finish_section_build"]);
  });
  it("reports a rejected commit and leaves the section stale instead of reporting success", async () => {
    const call = vi.fn(async (fn: string) => {
      if (fn === "claim_section_build") return { claimed: true };
      if (fn === "read_section_state") return state;
      if (fn === "submit_change_set") return { changeSetId: "change", eventId: "event" };
      if (fn === "commit_change_set") return { status: "rejected", applied: 0 };
      return {};
    });
    await expect(refreshSectionStyle({ call: call as import("@/lib/db/rpc").DbRpc["call"] }, { name: "test", reviseSection: async () => ({ modelVersion: "test", revise: [{ lineId: "generated", text: "Updated", unitIds: ["a"] }], retire: [], add: [] }) }, "s")).rejects.toThrow("not fully applied");
    expect(call.mock.calls.map(([name]) => name)).toContain("mark_section_stale");
    expect(call.mock.calls.map(([name]) => name)).not.toContain("finish_section_build");
  });
});
