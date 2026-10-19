import { beforeEach, describe, expect, it, vi } from "vitest";
import { useExceptionCounts, useExceptionInbox } from "./useExceptionInbox";

const mocks = vi.hoisted(() => ({ from: vi.fn(), spaceId: "space-a" }));
vi.mock("@/components/shell/SpaceProvider", () => ({ useActiveSpace: () => ({ id: mocks.spaceId }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => options }));
vi.mock("@/lib/supabase/client", () => ({ getBrowserSupabase: () => ({ from: mocks.from }) }));

function fixture() {
  const exceptions = Array.from({ length: 25 }, (_, i) => ({ id: "e" + i, action_id: "a" + i }));
  const query = {
    select: vi.fn(), filter: vi.fn(), eq: vi.fn(), neq: vi.fn(), in: vi.fn(), or: vi.fn(), order: vi.fn(), range: vi.fn(),
  };
  for (const method of Object.values(query)) method.mockReturnValue(query);
  query.range.mockResolvedValue({ data: exceptions, count: 1000, error: null });
  const actionIds = vi.fn().mockResolvedValue({ data: [{ id: "a0" }], error: null });
  mocks.from.mockImplementation((table) => table === "exceptions" ? query : { select: () => ({ in: actionIds }) });
  return { query, actionIds };
}
beforeEach(() => { vi.clearAllMocks(); mocks.spaceId = "space-a"; });
describe("exception inbox pagination", () => {
  it("loads only a page and its actions even when 1,000 exceptions match", async () => {
    const { query, actionIds } = fixture();
    const options = useExceptionInbox("open", "all", 20, "", true) as unknown as { queryFn: () => Promise<{ count: number; rows: unknown[] }> };
    const result = await options.queryFn();
    expect(query.range).toHaveBeenCalledWith(500, 524);
    expect(query.eq).toHaveBeenCalledWith("status", "open");
    expect(query.filter).toHaveBeenCalledWith("space_id", "eq", "space-a");
    expect(query.order.mock.calls).toEqual([["created_at", { ascending: true }], ["id", { ascending: true }]]);
    expect(actionIds.mock.calls[0]![1]).toHaveLength(25);
    expect(result.count).toBe(1000);
    expect(result.rows).toHaveLength(25);
  });
  it("separates inbox and badge caches when the active space changes", async () => {
    type QueryOptions = { queryKey: unknown[]; queryFn: () => Promise<unknown> };
    const firstInbox = useExceptionInbox("open", "all", 0, "", true) as unknown as QueryOptions;
    const firstCounts = useExceptionCounts() as unknown as QueryOptions;
    mocks.spaceId = "space-b";
    const { query } = fixture();
    const nextInbox = useExceptionInbox("open", "all", 0, "", true) as unknown as QueryOptions;
    const nextCounts = useExceptionCounts() as unknown as QueryOptions;
    expect(nextInbox.queryKey).not.toEqual(firstInbox.queryKey);
    expect(nextCounts.queryKey).not.toEqual(firstCounts.queryKey);
    await nextInbox.queryFn();
    expect(query.filter).toHaveBeenCalledWith("space_id", "eq", "space-b");
    query.filter.mockClear();
    await nextCounts.queryFn();
    expect(query.filter.mock.calls).toEqual([["space_id", "eq", "space-b"], ["space_id", "eq", "space-b"]]);
  });
  it("filters answered status and category in the database before pagination", async () => {
    const { query } = fixture();
    const options = useExceptionInbox("answered", "conflicts", 0, "", false) as unknown as { queryFn: () => Promise<unknown> };
    await options.queryFn();
    expect(query.neq).toHaveBeenCalledWith("status", "open");
    expect(query.in).toHaveBeenCalledWith("reason", ["decision_conflict", "source_tie"]);
    expect(query.range).toHaveBeenCalledWith(0, 24);
  });
  it("quotes search punctuation and treats wildcard characters as literal input", async () => {
    const { query } = fixture();
    const options = useExceptionInbox("open", "all", 0, '100%, "test"', true) as unknown as { queryFn: () => Promise<unknown> };
    await options.queryFn();
    expect(query.or.mock.calls[0]![0]).toContain('evidence->>detail.ilike.' + JSON.stringify('%100\\%, "test"%'));
  });
});
