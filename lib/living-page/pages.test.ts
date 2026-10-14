import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DraftAction } from "@/lib/ai/types";
import { commitPersonEdit, revertChangeSet } from "@/lib/change-control";
import type { DbRpc } from "@/lib/db/rpc";
import { hasLocalPostgres, type LocalPostgres, startLocalPostgres } from "@/test/db/localPostgres";
import { pgRpc } from "@/test/db/pgRpc";
import { FakeSectionWriter, rebuildAfterEvent } from "./index";
import { MIN_CLAIMS_FOR_PAGE, type PageCandidate, pageProposalActions, proposePages } from "./proposePages";

// =====================================================================
// PAGES FROM THE KNOWLEDGE, AND PAGE EDITS AS TYPED ACTIONS
// =====================================================================

// A CANDIDATE with sensible defaults
const candidate = (over: Partial<PageCandidate> = {}): PageCandidate => ({
  entityId: "e1",
  type: "project",
  key: "alpha",
  name: "Alpha",
  claimCount: MIN_CLAIMS_FOR_PAGE,
  kinds: ["fact", "decision"],
  page: null,
  ...over,
});

describe("pageProposalActions (pure)", () => {
  it("gives an entity with enough claims a page named after it, decisions first", () => {
    const [action] = pageProposalActions([candidate()]);
    expect(action?.type).toBe("create_page");
    if (action?.type !== "create_page") return;
    expect(action.input.title).toBe("Alpha");
    expect(action.input.sections.map((section) => section.title)).toEqual(["Decisions", "Facts"]);
    expect(action.input.sections[0]?.query).toEqual({ entity: { type: "project", key: "alpha" }, kinds: ["decision"] });
  });

  it("skips an entity with too few claims", () => {
    expect(pageProposalActions([candidate({ claimCount: MIN_CLAIMS_FOR_PAGE - 1 })])).toEqual([]);
  });

  it("adds only the missing kind to an existing page, and nothing to a page that shows every kind", () => {
    const page = { pageId: "p1", coveredKinds: ["fact" as const], coversAll: false };
    const actions = pageProposalActions([candidate({ page })]);
    expect(actions.map((action) => action.type)).toEqual(["create_section"]);
    expect(actions[0]?.input).toMatchObject({ pageId: "p1", title: "Decisions" });
    expect(pageProposalActions([candidate({ page: { ...page, coversAll: true } })])).toEqual([]);
  });
});

describe.skipIf(!hasLocalPostgres())("pages on a throwaway Postgres", () => {
  let pg: LocalPostgres;
  let client: Client;
  let db: DbRpc;

  // Live pages with their live section titles
  const readPages = async () =>
    (
      await client.query<{ id: string; title: string; sections: string[] }>(
        `select p.id, p.title, coalesce(array_agg(s.title order by s.position) filter (where s.id is not null), '{}') as sections
         from public.pages p left join public.sections s on s.page_id = p.id and s.retired_at is null
         where p.retired_at is null group by p.id order by p.title`,
      )
    ).rows;

  // Number of shown lines on a page
  const countLines = async (pageId: string) =>
    Number((await client.query<{ n: string }>("select count(*) as n from public.section_lines where page_id = $1", [pageId])).rows[0]?.n);

  beforeAll(async () => {
    pg = await startLocalPostgres();
    client = await pg.connect();
    db = pgRpc(client);
  });

  afterAll(async () => {
    await client?.end();
    await pg?.stop();
  });

  // Beta: a new entity and two claims about it, committed as one person edit (like an upload's ChangeSet)
  const BETA = { type: "project", key: "beta" };
  const claim = (content: string, kind: "fact" | "decision"): DraftAction => ({
    type: "add_claim",
    targetId: null,
    expectedRevisionId: null,
    passageIds: [],
    speechAct: null,
    input: { content, kind, epistemicStatus: "established", validFrom: "2026-10-01", entities: [{ ...BETA, role: "subject" }], domainPaths: [] },
  });

  it("new knowledge proposes a page for its entity, and the page's lines are written", async () => {
    const before = (await readPages()).map((page) => page.title);
    const { eventId } = await commitPersonEdit(db, "Beta", [
      { type: "create_entity", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null, input: { ...BETA, name: "Beta", aliases: [] } },
      claim("Beta ships in November.", "decision"),
      claim("Beta has three engineers.", "fact"),
    ]);
    expect(await proposePages(db, eventId)).toBe(1);
    await rebuildAfterEvent(db, new FakeSectionWriter(), eventId);
    const beta = (await readPages()).find((page) => !before.includes(page.title));
    expect(beta).toMatchObject({ title: "Beta", sections: ["Decisions", "Facts"] });
    expect(await countLines(beta!.id)).toBe(2);
    // Run again: the page exists and shows both kinds, so nothing more is proposed
    expect(await proposePages(db, eventId)).toBe(0);
  });

  it("a person renames a page, adds, renames and removes a section, and undo restores each", async () => {
    const page = (await readPages()).find((row) => row.title === "Beta");
    if (!page) throw new Error("No page to edit.");
    const edit = (summary: string, action: Parameters<typeof commitPersonEdit>[2][number]) => commitPersonEdit(db, summary, [action]);
    const base = { expectedRevisionId: null, passageIds: [], speechAct: null };

    const renamed = await edit("Rename", { ...base, type: "rename_page", targetId: page.id, input: { title: "Renamed" } });
    expect(renamed.status).toBe("applied");
    const added = await edit("Add", { ...base, type: "create_section", targetId: null, input: { pageId: page.id, title: "Notes", query: {} } });
    expect(added.status).toBe("applied");
    const sectionId = (await client.query<{ target_id: string }>("select target_id from public.actions where change_set_id = $1", [added.changeSetId])).rows[0]!.target_id;
    await edit("Rename section", { ...base, type: "rename_section", targetId: sectionId, input: { title: "More notes" } });
    const readBeta = async () => (await readPages()).find((row) => row.id === page.id);
    expect(await readBeta()).toMatchObject({ title: "Renamed", sections: [...page.sections, "More notes"] });

    const removed = await edit("Remove", { ...base, type: "retire_section", targetId: sectionId, input: {} });
    expect((await readBeta())?.sections).toEqual(page.sections);
    await revertChangeSet(db, removed.changeSetId);
    expect((await readBeta())?.sections).toEqual([...page.sections, "More notes"]);
    await revertChangeSet(db, renamed.changeSetId);
    expect((await readBeta())?.title).toBe(page.title);
  });

  it("an empty title is rejected", async () => {
    const [page] = await readPages();
    const result = await commitPersonEdit(db, "Blank", [
      { type: "rename_page", targetId: page!.id, expectedRevisionId: null, passageIds: [], speechAct: null, input: { title: "  " } },
    ]);
    expect(result.status).toBe("rejected");
  });
});
