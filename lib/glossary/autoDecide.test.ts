import { beforeEach, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import { autoDecideGlossary, glossaryDecisionGroups } from "./autoDecide";

const { chat } = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("@/lib/ai/chat", () => ({ chatJson: chat }));
beforeEach(() => chat.mockReset());
const saved = { meaningId: "saved", definition: "A manually written definition.", personEdited: true };
const pending = { entry: { meaningId: "new", term: "Term" }, candidateIds: ["saved"] };
const settings = { apiKey: "test", model: "test" };

it("asks once when pending proposals share a saved meaning", () => {
  const grouped = glossaryDecisionGroups([
    { candidateIds: ["saved"] },
    { candidateIds: ["other"] },
    { candidateIds: ["saved", "other"] },
  ]);
  expect(grouped).toHaveLength(1);
  expect(grouped[0]).toHaveLength(3);
});

it("makes no AI call while off or while generation owns the glossary", async () => {
  const call = vi.fn().mockResolvedValue(null);
  await autoDecideGlossary({ call } as DbRpc, settings);
  expect(chat).not.toHaveBeenCalled();
});

it("saves a choice with the reviewed snapshot, preserves human wording, and stops after switch-off", async () => {
  const call = vi.fn().mockResolvedValueOnce({ entries: [saved], pending: [pending] }).mockResolvedValueOnce(true).mockResolvedValueOnce(null);
  chat.mockResolvedValue({ value: { decision: "merge", target: "saved", definition: "A replacement from the model.", reason: "Same meaning." } });
  await autoDecideGlossary({ call } as DbRpc, settings);
  expect(call).toHaveBeenNthCalledWith(2, "apply_glossary_auto_decision", {
    p_item: pending, p_candidates: [saved], p_decision: "merge", p_target: "saved", p_definition: saved.definition, p_reason: "Same meaning.",
  });
  expect(chat).toHaveBeenCalledTimes(1);
});

it("uses one model call for proposals that share a candidate", async () => {
  const second = { entry: { meaningId: "also", term: "Also" }, candidateIds: ["saved"] };
  const call = vi.fn()
    .mockResolvedValueOnce({ entries: [saved], pending: [pending, second] })
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce({ entries: [saved], pending: [second] })
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(null);
  chat.mockResolvedValue({ value: { decision: "keep", target: null, definition: null, reason: "Distinct meaning." } });
  await autoDecideGlossary({ call } as DbRpc, settings);
  expect(chat).toHaveBeenCalledTimes(1);
});

it("rejects an invented merge target without applying anything", async () => {
  const call = vi.fn().mockResolvedValue({ entries: [saved], pending: [pending] });
  chat.mockResolvedValue({ value: { decision: "merge", target: "invented", definition: "An invented combined meaning.", reason: "Same meaning." } });
  await expect(autoDecideGlossary({ call } as DbRpc, settings)).rejects.toThrow("invalid match");
  expect(call).toHaveBeenCalledTimes(1);
});

it("does not loop forever when a stale decision is rejected", async () => {
  const call = vi.fn(async (name: string) => name === "get_glossary_auto_decide" ? { entries: [saved], pending: [pending] } : false);
  chat.mockResolvedValue({ value: { decision: "keep", target: null, definition: null, reason: "Distinct meaning." } });
  await autoDecideGlossary({ call } as DbRpc, settings);
  expect(chat).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledTimes(3);
});
