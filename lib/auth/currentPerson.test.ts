import { beforeEach, expect, it, vi } from "vitest";
import { currentActor } from "./currentPerson";

const mocks = vi.hoisted(() => ({ claims: vi.fn(), store: { get: vi.fn() } }));
vi.mock("next/headers", () => ({ cookies: async () => mocks.store }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { getClaims: mocks.claims } }) }));
beforeEach(() => {
  mocks.store = { get: vi.fn() };
  mocks.claims.mockReset();
});

it("fails closed if account verification fails instead of becoming a trusted script", async () => {
  const error = new Error("Account service is unavailable");
  mocks.claims.mockResolvedValue({ data: null, error });
  await expect(currentActor()).rejects.toBe(error);
});

it("ignores selected-space cookies when there is no signed-in account", async () => {
  mocks.store.get.mockReturnValue({ value: "10000000-0000-4000-8000-000000000001" });
  mocks.claims.mockResolvedValue({ data: null, error: { name: "AuthSessionMissingError" } });
  expect(await currentActor()).toEqual({ personId: null, via: "api", spaceId: null });
});

it("uses the verified account identity with its requested space", async () => {
  const id = "10000000-0000-4000-8000-000000000001";
  mocks.store.get.mockReturnValue({ value: id });
  mocks.claims.mockResolvedValue({ data: { claims: { sub: "verified-account" } }, error: null });
  expect(await currentActor()).toEqual({ personId: "verified-account", via: "app", spaceId: id });
});
