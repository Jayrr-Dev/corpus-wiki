import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ deps: vi.fn(), admin: vi.fn(), rebuild: vi.fn(), enabled: vi.fn(), review: vi.fn() }));
vi.mock("@/lib/auth/requireUser", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/server/deps", () => ({ getServerDeps: mocks.deps }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: mocks.admin }));
vi.mock("@/lib/ai/models", async (original) => ({ ...await original<object>(), readAutoUpdateStale: mocks.enabled }));
vi.mock("@/lib/living-page", async (original) => ({ ...await original<object>(), rebuildSection: mocks.rebuild }));
vi.mock("next/server", () => ({ after: vi.fn() }));

import { refreshStaleSections } from "./pages";
const id = "10000000-0000-4000-8000-000000000001";
let status: string;
let cancelled: boolean;
beforeEach(() => {
  vi.clearAllMocks();
  status = "stale";
  cancelled = false;
  mocks.rebuild.mockResolvedValue({ rebuildRequested: false });
  mocks.enabled.mockResolvedValue(true);
  mocks.deps.mockResolvedValue({ db: { call: vi.fn(async () => ({ lines: [] })) }, writer: { name: "test", reviewSections: mocks.review } });
  const query = { select: () => query, eq: () => query, order: () => query, range: async () => ({ data: [], error: null }),
    maybeSingle: async () => ({ data: { status, build_cancelled: cancelled }, error: null }) };
  mocks.admin.mockReturnValue({ from: () => query });
});

it("retries a stale section even when none of its citations are outdated", async () => {
  expect(await refreshStaleSections([id])).toEqual({ ok: true, sections: 1 });
  expect(mocks.rebuild).toHaveBeenCalledWith(expect.anything(), expect.anything(), id, null, false, { skipEditorialReview: true });
  expect(mocks.review).toHaveBeenCalledOnce();
  expect(mocks.review).toHaveBeenCalledWith([id]);
});

it.each(["building", "current"])("does not restart a %s section with current citations", async (value) => {
  status = value;
  expect(await refreshStaleSections([id])).toEqual({ ok: true, sections: 0 });
  expect(mocks.rebuild).not.toHaveBeenCalled();
});

it("respects disabled automatic updates", async () => {
  mocks.enabled.mockResolvedValue(false);
  expect(await refreshStaleSections([id])).toEqual({ ok: true, sections: 0 });
  expect(mocks.rebuild).not.toHaveBeenCalled();
});

it("does not automatically resume a cancelled section", async () => {
  cancelled = true;
  expect(await refreshStaleSections([id])).toEqual({ ok: true, sections: 0 });
  expect(mocks.rebuild).not.toHaveBeenCalled();
});

it("does not report an unclaimed build as completed", async () => {
  mocks.rebuild.mockResolvedValue(null);
  expect(await refreshStaleSections([id])).toEqual({ ok: true, sections: 0 });
});
