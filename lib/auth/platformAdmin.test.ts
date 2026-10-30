import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), agent: vi.fn() }));
vi.mock("@/lib/auth/requireUser", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/agents/session", () => ({ currentAgentSession: mocks.agent }));

import { isPlatformAdmin, requirePlatformAdmin } from "./platformAdmin";

const env = (values: Record<string, string>) => ({ NODE_ENV: "production", ...values }) as NodeJS.ProcessEnv;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.agent.mockReturnValue(null);
  vi.stubEnv("PLATFORM_ADMIN_EMAILS", "owner@example.com");
});

it("lets everyone through in local development", () => {
  expect(isPlatformAdmin(null, { NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
});

it("matches a listed email, ignoring case and spaces", () => {
  const listed = env({ PLATFORM_ADMIN_EMAILS: " Owner@Example.com , second@example.com" });
  expect(isPlatformAdmin("owner@example.com", listed)).toBe(true);
  expect(isPlatformAdmin("SECOND@example.com", listed)).toBe(true);
});

it("refuses anyone else outside development", () => {
  expect(isPlatformAdmin("member@example.com", env({ PLATFORM_ADMIN_EMAILS: "owner@example.com" }))).toBe(false);
  expect(isPlatformAdmin(null, env({ PLATFORM_ADMIN_EMAILS: "owner@example.com" }))).toBe(false);
});

it("refuses everyone when the list is empty", () => {
  expect(isPlatformAdmin("owner@example.com", env({}))).toBe(false);
  expect(isPlatformAdmin("", env({ PLATFORM_ADMIN_EMAILS: "" }))).toBe(false);
});

it("guards an action for a listed person only", async () => {
  mocks.requireUser.mockResolvedValue({ id: "p", email: "owner@example.com" });
  await expect(requirePlatformAdmin()).resolves.toMatchObject({ id: "p" });
  mocks.requireUser.mockResolvedValue({ id: "q", email: "member@example.com" });
  await expect(requirePlatformAdmin()).rejects.toThrow("Only a platform admin");
});

it("never passes an agent, even one acting for a listed person", async () => {
  mocks.requireUser.mockResolvedValue({ id: "p", email: "owner@example.com" });
  mocks.agent.mockReturnValue({ key: { personId: "p" }, spaceId: null });
  await expect(requirePlatformAdmin()).rejects.toThrow("Only a platform admin");
});
