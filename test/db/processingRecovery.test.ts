import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import { splitIntoPassages } from "@/lib/ingest/passages";

describe("durable processing dispatch and provider budgets", () => {
  let store: Awaited<ReturnType<typeof portablePostgres>>;
  beforeAll(async () => { store = await portablePostgres(); });
  afterAll(async () => { await store.pg.close(); });
  beforeEach(async () => { await store.pg.exec("begin"); });
  afterEach(async () => { await store.pg.exec("rollback"); });
  async function upload() {
    const result = await store.db.call<{ eventId: string }>("ingest_source", {
      p_title: "Recovery fixture", p_mime_type: "text/plain", p_source_date: "2026-10-17T00:00:00Z", p_hash: "recovery-fixture", p_storage_path: "test/recovery.txt",
      p_passages: splitIntoPassages([{ text: "A source-backed fact.", page: null }]),
    });
    await store.pg.query("update public.upload_recovery_jobs set available_at=now()-interval '1 second' where event_id=$1", [result.eventId]);
    return result.eventId;
  }
  it("persists pending work, has one dispatcher owner, and backs off failures", async () => {
    const event = await upload();
    const first = await store.db.call<{ eventId: string; token: string }>("claim_upload_recovery");
    expect(first.eventId).toBe(event);
    expect(await store.db.call("claim_upload_recovery")).toBeNull();
    await store.db.call("finish_upload_recovery", { p_event_id: event, p_token: first.token, p_error: "Transient failure" });
    expect(await store.db.call("claim_upload_recovery")).toBeNull();
    const rows = await store.pg.query<{ attempts: number; token: string | null }>("select attempts,token from public.upload_recovery_jobs where event_id=$1", [event]);
    expect(rows.rows[0]).toEqual({ attempts: 1, token: null });
  });
  it("does not recover explicit cancellations", async () => {
    const event = await upload();
    await store.db.call("cancel_upload_workflow", { p_event_id: event });
    expect(await store.db.call("claim_upload_recovery")).toBeNull();
    expect((await store.pg.query("select * from public.upload_recovery_jobs where event_id=$1", [event])).rows).toHaveLength(0);
  });
  it("does not recover archived sources or take over an active upload owner", async () => {
    const event = await upload();
    const owner = await store.db.call<{ token: string }>("claim_upload_workflow", { p_event_id: event });
    expect(await store.db.call("claim_upload_recovery")).toBeNull();
    await store.db.call("release_upload_workflow", { p_event_id: event, p_token: owner.token, p_state: "incomplete" });
    await store.pg.query("update public.upload_recovery_jobs set available_at=now()-interval '1 second' where event_id=$1", [event]);
    await store.pg.query("update public.sources set archived_at=now(),archive_reason='No longer needed by the test' where id=(select source_id from public.shift_events where id=$1)", [event]);
    expect(await store.db.call("claim_upload_recovery")).toBeNull();
  });
  it("stops after three failures without progress and manual resume resets the budget", async () => {
    const event = await upload();
    for (let attempt = 0; attempt < 3; attempt++) {
      const claim = await store.db.call<{ token: string }>("claim_upload_recovery");
      expect(claim).toBeTruthy();
      await store.db.call("finish_upload_recovery", { p_event_id: event, p_token: claim.token, p_error: "Failed" });
      await store.pg.query("update public.upload_recovery_jobs set available_at=now()-interval '1 second' where event_id=$1", [event]);
    }
    expect(await store.db.call("claim_upload_recovery")).toBeNull();
    const owner = await store.db.call<{ token: string }>("claim_upload_workflow", { p_event_id: event });
    await store.db.call("release_upload_workflow", { p_event_id: event, p_token: owner.token, p_state: "incomplete" });
    await store.pg.query("update public.upload_recovery_jobs set available_at=now()-interval '1 second' where event_id=$1", [event]);
    expect(await store.db.call("claim_upload_recovery")).toBeTruthy();
  });
  it("resets the retry budget when a continuation saves a new completed checkpoint", async () => {
    const event = await upload();
    const claim = await store.db.call<{ token: string }>("claim_upload_recovery");
    const owner = await store.db.call<{ token: string }>("claim_upload_workflow", { p_event_id: event });
    await store.db.call("start_upload_step", { p_event_id: event, p_token: owner.token, p_key: "test" });
    await store.pg.query("update public.upload_steps set state='succeeded' where event_id=$1 and key='test'", [event]);
    await store.db.call("release_upload_workflow", { p_event_id: event, p_token: owner.token, p_state: "incomplete" });
    await store.db.call("finish_upload_recovery", { p_event_id: event, p_token: claim.token });
    expect((await store.pg.query<{ attempts: number }>("select attempts from public.upload_recovery_jobs where event_id=$1", [event])).rows[0]!.attempts).toBe(0);
  });
  it("keeps dispatch and provider permit RPCs restricted to the service role", async () => {
    const functions = ["claim_upload_recovery()", "renew_upload_recovery(uuid,uuid)", "finish_upload_recovery(uuid,uuid,text)",
      "claim_processing_slot(text,integer)", "renew_processing_slot(text,uuid)", "release_processing_slot(text,uuid)"];
    for (const fn of functions) {
      const result = await store.pg.query<{ anonymous: boolean; signed_in: boolean; service: boolean }>(
        "select has_function_privilege('anon',$1,'EXECUTE') anonymous,has_function_privilege('authenticated',$1,'EXECUTE') signed_in,has_function_privilege('service_role',$1,'EXECUTE') service", [fn]);
      expect(result.rows[0]).toEqual({ anonymous: false, signed_in: false, service: true });
    }
  });
  it("does not reset the automatic retry budget for saved rejection notes alone", async () => {
    const event = await upload();
    for (let attempt=0;attempt<3;attempt++) {
      const dispatch = await store.db.call<{token:string}>("claim_upload_recovery");
      expect(dispatch).toBeTruthy();
      const owner = await store.db.call<{token:string}>("claim_upload_workflow", {p_event_id:event,p_continue:true});
      const args = {p_event_id:event,p_token:owner.token,p_key:`place-v4:batch:repair-v1:${attempt}`};
      await store.db.call("start_upload_step",args);
      await store.db.call("finish_upload_step",{...args,p_output:{feedback:"Still rejected"},p_error:null});
      await store.db.call("release_upload_workflow",{p_event_id:event,p_token:owner.token,p_state:"incomplete"});
      await store.db.call("finish_upload_recovery",{p_event_id:event,p_token:dispatch.token,p_error:"Review remains unresolved"});
      await store.pg.query("update public.upload_recovery_jobs set available_at=now()-interval '1 second' where event_id=$1",[event]);
    }
    expect(await store.db.call("claim_upload_recovery")).toBeNull();
    expect((await store.pg.query<{attempts:number}>("select attempts from public.upload_recovery_jobs where event_id=$1",[event])).rows[0]!.attempts).toBe(3);
  });
  it("recovers expired owners while refusing to release a replacement dispatch", async () => {
    const event = await upload();
    const first = await store.db.call<{ token: string }>("claim_upload_recovery");
    await store.pg.query("update public.upload_recovery_jobs set lease_until=now()-interval '1 second' where event_id=$1", [event]);
    const second = await store.db.call<{ token: string }>("claim_upload_recovery");
    expect(second.token).not.toBe(first.token);
    await store.db.call("finish_upload_recovery", { p_event_id: event, p_token: first.token });
    expect((await store.pg.query<{ token: string }>("select token from public.upload_recovery_jobs where event_id=$1", [event])).rows[0]!.token).toBe(second.token);
  });
  it("does not count paid outline drafts and review answers as completed recovery progress", async () => {
    const event = await upload();
    for (let attempt = 0; attempt < 3; attempt++) {
      const dispatch = await store.db.call<{ token: string }>("claim_upload_recovery");
      const owner = await store.db.call<{ token: string }>("claim_upload_workflow", { p_event_id: event, p_continue: true });
      for (const kind of ["draft", "review-v2"]) {
        const args = { p_event_id: event, p_token: owner.token, p_key: `outline-v1:fixture:${attempt}:${kind}` };
        await store.db.call("start_upload_step", args);
        await store.db.call("finish_upload_step", { ...args, p_output: { accepted: false }, p_error: null });
      }
      await store.db.call("release_upload_workflow", { p_event_id: event, p_token: owner.token, p_state: "incomplete" });
      await store.db.call("finish_upload_recovery", { p_event_id: event, p_token: dispatch.token, p_error: "No publishable plan" });
      await store.pg.query("update public.upload_recovery_jobs set available_at=now()-interval '1 second' where event_id=$1", [event]);
    }
    expect(await store.db.call("claim_upload_recovery")).toBeNull();
    expect((await store.pg.query("select key from public.upload_steps where event_id=$1 and state='succeeded'", [event])).rows).toHaveLength(6);
  });
  it("stops automatic retries on an explicitly rejected outline even when other work was saved", async () => {
    const event = await upload();
    const dispatch = await store.db.call<{ token: string }>("claim_upload_recovery");
    const owner = await store.db.call<{ token: string }>("claim_upload_workflow", { p_event_id: event, p_continue: true });
    const args = { p_event_id: event, p_token: owner.token, p_key: "rebuild-section:initial:completed" };
    await store.db.call("start_upload_step", args);
    await store.db.call("finish_upload_step", { ...args, p_output: {}, p_error: null });
    await store.db.call("release_upload_workflow", { p_event_id: event, p_token: owner.token, p_state: "incomplete" });
    await store.db.call("finish_upload_recovery", { p_event_id: event, p_token: dispatch.token, p_error: "pages: Outline needs review after 12 attempts; nothing was published." });
    await store.pg.query("update public.upload_recovery_jobs set available_at=now()-interval '1 second' where event_id=$1", [event]);
    expect(await store.db.call("claim_upload_recovery")).toBeNull();
    expect((await store.pg.query<{ attempts: number }>("select attempts from public.upload_recovery_jobs where event_id=$1", [event])).rows[0]!.attempts).toBe(3);
  });
  it("bounds provider requests across instances and fences stale permit releases", async () => {
    const first = await store.db.call<string>("claim_processing_slot", { p_scope: "test", p_limit: 1 });
    expect(first).toBeTruthy();
    expect(await store.db.call("claim_processing_slot", { p_scope: "test", p_limit: 1 })).toBeNull();
    await store.pg.query("update public.processing_request_slots set lease_until=now()-interval '1 second' where token=$1", [first]);
    const replacement = await store.db.call<string>("claim_processing_slot", { p_scope: "test", p_limit: 1 });
    await store.db.call("release_processing_slot", { p_scope: "test", p_token: first });
    expect(await store.db.call("claim_processing_slot", { p_scope: "test", p_limit: 1 })).toBeNull();
    expect(await store.db.call("renew_processing_slot", { p_scope: "test", p_token: replacement })).toBe(true);
    await store.db.call("release_processing_slot", { p_scope: "test", p_token: replacement });
    expect(await store.db.call("claim_processing_slot", { p_scope: "test", p_limit: 1 })).toBeTruthy();
  });
});
