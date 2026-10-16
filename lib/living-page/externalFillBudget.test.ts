import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSupabase } from "@/lib/supabase/admin";
import type { SectionWriter } from "./index";
import { approveExternalSearch } from "@/lib/knowledge/externalApproval";
import { startExternalSource } from "@/lib/ingest";
import { searchWeb } from "@/lib/knowledge/webSearch";
import { fillThinSectionsFromWeb } from "./forceCreateSection";

vi.mock("@/lib/ingest", () => ({ startExternalSource: vi.fn(), processExternalEvent: vi.fn() }));
vi.mock("@/lib/knowledge/externalApproval", () => ({ approveExternalSearch: vi.fn(), approveExternalSource: vi.fn() }));
vi.mock("@/lib/knowledge/webSearch", () => ({ searchWeb: vi.fn() }));
vi.mock("@/lib/knowledge/externalReviewStore", () => ({ externalReviewRecorder: () => vi.fn(), externalProjectContext: async () => ({ projectFacts: ["Company policy"], existingKnowledge: [], sourceTitles: [], organization: "Company", article: "Safety", section: "WHMIS" }) }));

beforeEach(() => vi.clearAllMocks());
describe("bounded independent approval of automatic web fills", () => {
  it("counts rejected attempts toward the limit and never searches or stores when approval is refused", async () => {
    vi.mocked(approveExternalSearch).mockResolvedValue(null);
    const client = { from: (table: string) => {
      const query = {
        select: () => query, eq: () => query, is: () => query, gte: () => query, limit: () => query,
        maybeSingle: async () => ({ data: { mode: "generated" }, error: null }),
        single: async () => ({ data: table === "pages" ? { id: "page", title: "Safety", entity_id: null, context_entity_id: null } : { id: "section", page_id: "page", title: "WHMIS", mode: "generated", query: {} }, error: null }),
        then: (resolve: (value: { data: never[]; error: null }) => unknown) => Promise.resolve(resolve({ data: [], error: null })),
      };
      return query;
    } } as unknown as AdminSupabase;
    const db = { call: vi.fn().mockResolvedValue({ units: [], lines: [] }) };
    const filled = await fillThinSectionsFromWeb({ db, client, settings: { apiKey: "test" }, writer: {} as SectionWriter, webSearchKey: null }, ["a", "b", "c", "d"], "", 2);
    expect(filled).toEqual([]);
    expect(approveExternalSearch).toHaveBeenCalledTimes(2);
    expect(searchWeb).not.toHaveBeenCalled();
    expect(startExternalSource).not.toHaveBeenCalled();
  });
});
