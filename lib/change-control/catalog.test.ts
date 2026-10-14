import type { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PersonAction } from "@/lib/change-control/types";
import { hasLocalPostgres, type LocalPostgres, startLocalPostgres } from "@/test/db/localPostgres";
import { pgRpc } from "@/test/db/pgRpc";
import { commitPersonAction, revertChangeSet } from ".";

// =====================================================================
// CATALOG EDITS: renaming and retiring entities and domains through
// Change control, and undoing them (supabase/migrations/…_catalog_edits.sql)
// =====================================================================

// SEED ROWS (supabase/seed.sql)
const ALPHA_ENTITY = "00000000-0000-4000-8000-0e0000000001";
const ALPHA_DOMAIN = "00000000-0000-4000-8000-0d0000000004";
const PROJECTS_DOMAIN = "00000000-0000-4000-8000-0d0000000003";
const CHARTER_EVENT = "00000000-0000-4000-8000-0f0000000001";

// A person's catalog action on one target
const catalogAction = (type: PersonAction["type"], targetId: string, input: object) =>
  ({ type, targetId, expectedRevisionId: null, passageIds: [], speechAct: null, input }) as PersonAction;

describe.skipIf(!hasLocalPostgres())("catalog edits", () => {
  let db: LocalPostgres;
  let client: Client;
  const rpc = () => pgRpc(client);

  beforeEach(async () => {
    db = await startLocalPostgres();
    client = await db.connect();
  });

  afterEach(async () => {
    await client?.end();
    await db?.stop();
  });

  const paths = async () => (await client.query<{ path: string }>("select path from public.domains order by path")).rows.map((row) => row.path);
  const retiredDomains = async () =>
    (await client.query<{ path: string }>("select path from public.domains where retired_at is not null order by path")).rows.map((row) => row.path);

  it("renames an entity and undoes it", async () => {
    const result = await commitPersonAction(rpc(), catalogAction("update_entity", ALPHA_ENTITY, { name: "Alpha Platform", aliases: ["AP"] }));
    expect(result.status).toBe("applied");
    const renamed = (await client.query("select name, aliases, key from public.entities where id = $1", [ALPHA_ENTITY])).rows[0];
    expect(renamed).toEqual({ name: "Alpha Platform", aliases: ["AP"], key: "alpha" });
    await revertChangeSet(rpc(), result.changeSetId);
    const restored = (await client.query("select name, aliases from public.entities where id = $1", [ALPHA_ENTITY])).rows[0];
    expect(restored).toEqual({ name: "Project Alpha", aliases: ["Alpha"] });
  });

  it("retires an entity, hides it from the model, and rejects editing it after", async () => {
    await commitPersonAction(rpc(), catalogAction("retire_entity", ALPHA_ENTITY, { reason: "Cancelled" }));
    const input = await rpc().call<{ entities: unknown[] }>("reconciliation_input", { p_event_id: CHARTER_EVENT });
    expect(input.entities).toEqual([]);
    const again = await commitPersonAction(rpc(), catalogAction("update_entity", ALPHA_ENTITY, { name: "X", aliases: [] }));
    expect(again.status).toBe("rejected");
  });

  it("renames a domain with its subtree, and undoes it", async () => {
    const result = await commitPersonAction(rpc(), catalogAction("update_domain", ALPHA_DOMAIN, { name: "Alpha 2" }));
    expect(result.status).toBe("applied");
    expect(await paths()).toContain("Projects/Alpha 2/Data layer");
    await revertChangeSet(rpc(), result.changeSetId);
    expect(await paths()).toContain("Projects/Alpha/Data layer");
  });

  it("rejects a rename onto a path that is taken", async () => {
    const result = await commitPersonAction(rpc(), catalogAction("update_domain", PROJECTS_DOMAIN, { name: "Topics" }));
    expect(result.status).toBe("rejected");
  });

  it("retires a domain with its subtree, and undoes it", async () => {
    const result = await commitPersonAction(rpc(), catalogAction("retire_domain", ALPHA_DOMAIN, { reason: "Done" }));
    expect(await retiredDomains()).toEqual(["Projects/Alpha", "Projects/Alpha/Data layer", "Projects/Alpha/Planning"]);
    await revertChangeSet(rpc(), result.changeSetId);
    expect(await retiredDomains()).toEqual([]);
  });
});
