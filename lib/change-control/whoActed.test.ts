import type { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasLocalPostgres, type LocalPostgres, startLocalPostgres } from "@/test/db/localPostgres";
import { pgRpc } from "@/test/db/pgRpc";
import { commitPersonAction, revertChangeSet, submitChangeSet } from ".";

// =====================================================================
// WHO ACTED (supabase/migrations/20261031000000_profiles.sql): a new
// account gets a profile, and rows written on a signed-in request point
// at that profile; AI rows carry the model instead.
// =====================================================================

const PERSON = "00000000-0000-4000-8000-0f0000000001";
const RELEASE_UNIT = "00000000-0000-4000-8000-010000000002";
const RELEASE_REVISION = "00000000-0000-4000-8000-0b0000000002";

describe.skipIf(!hasLocalPostgres())("who acted", () => {
  let db: LocalPostgres;
  let client: Client;
  const rpc = () => pgRpc(client);

  beforeEach(async () => {
    db = await startLocalPostgres();
    client = await db.connect();
    await client.query("insert into auth.users (id, email) values ($1, 'sam@example.com')", [PERSON]);
  });

  afterEach(async () => {
    await client?.end();
    await db?.stop();
  });

  // What the server's admin client sends on a signed-in request (lib/supabase/admin.ts)
  const signIn = (personId: string | null) =>
    client.query("select set_config('request.headers', $1, false)", [JSON.stringify(personId ? { "x-person-id": personId, "x-via": "app" } : {})]);

  const one = async <T>(sql: string, params: unknown[]) => (await client.query(sql, params)).rows[0] as T;

  it("creates a profile for a new account", async () => {
    expect(await one("select email, display_name from public.profiles where id = $1", [PERSON])).toEqual({ email: "sam@example.com", display_name: null });
  });

  it("names the person on their edit, its event and the revision", async () => {
    await signIn(PERSON);
    const { eventId } = await commitPersonAction(rpc(), {
      type: "revise_claim", targetId: RELEASE_UNIT, expectedRevisionId: RELEASE_REVISION,
      passageIds: [], speechAct: null, input: { content: "Alpha's first release moves to Q2 2027." },
    });
    expect(await one("select person_id, via from public.shift_events where id = $1", [eventId])).toEqual({ person_id: PERSON, via: "app" });
    expect(await one("select author_id from public.change_sets where event_id = $1", [eventId])).toEqual({ author_id: PERSON });
    expect(await one("select author_id from public.revisions where event_id = $1", [eventId])).toEqual({ author_id: PERSON });
  });

  it("names the person who undid a change", async () => {
    await signIn(PERSON);
    const { changeSetId } = await submitChangeSet(rpc(), { eventId: null, cause: "edit", actor: "person" }, {
      summary: "edit", actions: [{
        type: "revise_claim", targetId: RELEASE_UNIT, expectedRevisionId: RELEASE_REVISION,
        passageIds: [], speechAct: null, input: { content: "Q2 2027." },
      }], trace: { modelVersion: null, promptVersion: null, tokensIn: null, tokensOut: null },
    });
    await rpc().call("commit_change_set", { p_change_set_id: changeSetId });
    const { eventId } = await revertChangeSet(rpc(), changeSetId);
    expect(await one("select person_id from public.shift_events where id = $1", [eventId])).toEqual({ person_id: PERSON });
  });

  it("leaves AI rows without a person and keeps the model", async () => {
    await signIn(null);
    const { changeSetId } = await submitChangeSet(rpc(), { eventId: null, cause: "edit", actor: "ai" }, {
      summary: "AI edit", actions: [], trace: { modelVersion: "zai-org/GLM-5.3-Flash", promptVersion: null, tokensIn: null, tokensOut: null },
    });
    expect(await one("select author_id, model_version from public.change_sets where id = $1", [changeSetId]))
      .toEqual({ author_id: null, model_version: "zai-org/GLM-5.3-Flash" });
  });

  it("ignores a person id that has no profile", async () => {
    await signIn("00000000-0000-4000-8000-0f00000000ff");
    const { eventId } = await submitChangeSet(rpc(), { eventId: null, cause: "edit", actor: "person" }, {
      summary: "edit", actions: [], trace: { modelVersion: null, promptVersion: null, tokensIn: null, tokensOut: null },
    });
    expect(await one("select person_id from public.shift_events where id = $1", [eventId])).toEqual({ person_id: null });
  });
});
