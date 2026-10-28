import { beforeEach, expect, it, vi } from "vitest";
import { settingsTools } from "./settings";

const mocks = vi.hoisted(() => {
  const ok = () => vi.fn().mockResolvedValue({ ok: true });
  return {
    actions: { chooseAiEffort: ok(), chooseModel: ok(), chooseRoleEffort: ok(), chooseRoleModel: ok(), setAllowExternalKnowledge: ok(), setArticleCharter: ok(), setAutoUpdateStale: ok(), setGlossaryAutoDecide: ok() },
    charter: vi.fn(),
  };
});
vi.mock("@/lib/server-actions/settings", () => mocks.actions);
vi.mock("@/app/(app)/settings/loadModelSettings", () => ({
  loadAutoUpdateStale: async () => true,
  loadExternalKnowledge: async () => ({ enabled: false, ready: true }),
  loadArticleCharter: mocks.charter,
  loadGlossaryAutoDecide: async () => false,
  loadModelSettings: async () => ({ chosenModel: null, activeModel: "m1", visionModel: "v", roleModels: { curator: "m2" }, effort: "low", roleEfforts: {}, roleAuto: [], models: ["m1", "m2"], modelInputs: { m1: ["text"] }, listError: null }),
}));

const tool = (name: string) => settingsTools.find((entry) => entry.name === name)!;
const run = (name: string, args: unknown) => (tool(name).run as (args: unknown, context: unknown) => Promise<unknown>)(tool(name).input.parse(args), {});

beforeEach(() => { vi.clearAllMocks(); mocks.charter.mockResolvedValue({ purpose: "Old purpose", audience: "Staff", outOfScope: "" }); });

it("reads with the read scope and writes with the settings scope", () => {
  for (const entry of settingsTools) {
    expect(entry.scope).toBe(entry.name === "get_settings" ? "read" : "settings");
    expect(entry.annotations.readOnlyHint).toBe(entry.name === "get_settings");
    expect(Object.keys(entry.input.shape)).not.toContain("space");
  }
});

it("offers no password, name, monetization, speed test, full auto or secret tool", () => {
  for (const entry of settingsTools) expect(entry.name).not.toMatch(/password|name|monet|speed|auto_role|role_auto|key|secret|token/i);
  expect(settingsTools.map((entry) => entry.name).sort()).toEqual(["choose_effort", "choose_model", "choose_role_effort", "choose_role_model", "get_settings", "set_allow_external_knowledge", "set_article_charter", "set_auto_update_stale", "set_glossary_auto_decide"]);
});

it("reads the settings without the vision model or full auto", async () => {
  const settings = await run("get_settings", {}) as Record<string, unknown>;
  expect(settings).toMatchObject({ autoUpdateStale: true, allowExternalKnowledge: false, externalKnowledgeReady: true, glossaryAutoDecide: false, activeModel: "m1", effort: "low", roleModels: { curator: "m2" }, models: ["m1", "m2"], modelListError: null });
  expect(settings).not.toHaveProperty("roleAuto");
});

it("passes each setting to its action", async () => {
  await run("set_auto_update_stale", { enabled: true });
  expect(mocks.actions.setAutoUpdateStale).toHaveBeenCalledWith(true);
  await run("set_allow_external_knowledge", { enabled: false });
  expect(mocks.actions.setAllowExternalKnowledge).toHaveBeenCalledWith(false);
  await run("set_glossary_auto_decide", { enabled: true });
  expect(mocks.actions.setGlossaryAutoDecide).toHaveBeenCalledWith(true);
  await run("choose_model", { model: null });
  expect(mocks.actions.chooseModel).toHaveBeenCalledWith(null);
  await run("choose_role_model", { role: "curator", model: "m2" });
  expect(mocks.actions.chooseRoleModel).toHaveBeenCalledWith("curator", "m2");
  await run("choose_effort", { effort: "high" });
  expect(mocks.actions.chooseAiEffort).toHaveBeenCalledWith("high");
  await run("choose_role_effort", { role: "reviewer", effort: null });
  expect(mocks.actions.chooseRoleEffort).toHaveBeenCalledWith("reviewer", null);
});

it("keeps charter fields that were left out", async () => {
  expect(await run("set_article_charter", { purpose: "New purpose", outOfScope: "" })).toEqual({ ok: true });
  expect(mocks.actions.setArticleCharter).toHaveBeenCalledWith({ purpose: "New purpose", audience: "Staff", outOfScope: "" });
});

it("turns an action's error into a thrown error", async () => {
  mocks.actions.chooseModel.mockResolvedValueOnce({ ok: false, error: "No connected AI provider offers \"x\"." });
  await expect(run("choose_model", { model: "x" })).rejects.toThrow("No connected AI provider offers");
});

it("rejects unknown roles and efforts before calling an action", () => {
  expect(() => tool("choose_role_model").input.parse({ role: "boss", model: null })).toThrow();
  expect(() => tool("choose_effort").input.parse({ effort: "max" })).toThrow();
});
