import { beforeEach, expect, it, vi } from "vitest";
import { chatJson } from "@/lib/ai/chat";
import { updateNeedsStructure } from "./restructureUpdate";

vi.mock("@/lib/ai/chat", async (original) => ({ ...(await original<typeof import("@/lib/ai/chat")>()), chatJson: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

it("does not call a planner for an update without instructions", async () => {
  expect(await updateNeedsStructure({ apiKey: "test" }, "  ")).toBe(false);
  expect(chatJson).not.toHaveBeenCalled();
});

it("routes a requested split to planning and explains negation to the router", async () => {
  vi.mocked(chatJson).mockResolvedValueOnce({ value: { restructure: true }, tokensIn: 1, tokensOut: 1 } as never);
  expect(await updateNeedsStructure({ apiKey: "test" }, "Split into topics")).toBe(true);
  const request = vi.mocked(chatJson).mock.calls[0]![1];
  expect(request.messages[0]?.content).toContain("Respect negation");
  expect(request.messages[1]?.content).toBe("Split into topics");
});
