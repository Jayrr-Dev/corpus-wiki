import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { targetFromEnvironment } from "../scripts/db/targets.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const key = process.env.SUPABASE_SECRET_KEY;
const legacy = "00000000-0000-4000-8000-000000000001";
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const target = await targetFromEnvironment(process.env);
const created = [];
const spaces = [];
const clients = [];
try {
  for (let index = 0; index < 2; index++) {
    const email = `account-check-${randomUUID()}@example.test`;
    const password = `${randomUUID()}Aa1!`;
    const account = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (account.error) throw account.error;
    const id = account.data.user.id;
    created.push(id);
    const client = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
    clients.push(client);
    const login = await client.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
    const verified = await client.auth.getClaims();
    assert.equal(verified.data.claims.sub, id);
    const server = createClient(url, key, { auth: { persistSession: false }, global: { headers: { "x-person-id": verified.data.claims.sub } } });
    const own = await server.rpc("ensure_my_space");
    if (own.error) throw own.error;
    spaces.push(own.data.id);
    assert.equal(own.data.owner_id, id);
    assert.notEqual(own.data.id, legacy);
    for (const table of ["pages", "sources", "assets", "units"]) {
      const rows = await client.from(table).select("*", { count: "exact" }).limit(1);
      if (rows.error) throw rows.error;
      assert.equal(rows.count, 0, `New account must start without ${table}`);
    }
    const memory = await server.rpc("get_role_memory", { p_role: "reconciler", p_limit: 20 });
    if (memory.error) throw memory.error;
    assert.deepEqual(memory.data, []);
    const ownSpaces = await client.from("spaces").select("id,owner_id");
    assert.deepEqual(ownSpaces.data, [{ id: own.data.id, owner_id: id }]);
    const profiles = await client.from("profiles").select("id");
    assert.deepEqual(profiles.data, [{ id }]);
    const cookieMap = new Map();
    const ssr = createServerClient(url, publicKey, { cookies: {
      getAll: () => [...cookieMap].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => cookieMap.set(name, value)),
    } });
    const established = await ssr.auth.setSession({ access_token: login.data.session.access_token, refresh_token: login.data.session.refresh_token });
    if (established.error) throw established.error;
    const cookie = [...cookieMap].map(([name, value]) => `${name}=${value}`).join("; ");
    const page = await fetch("http://localhost:3003/", { headers: { cookie }, redirect: "manual" });
    assert.equal(page.status, 200, "SSR account onboarding must succeed");
    const html = await page.text();
    assert.ok(html.includes(email), "The app must show the signed-in account");
    console.log(`Account ${index + 1}: real sign-in, SSR onboarding, private profile and empty dataset passed.`);
  }
  for (let index = 0; index < clients.length; index++) {
    const session = await clients[index].auth.getSession();
    const forged = createClient(url, publicKey, { auth: { persistSession: false }, global: { headers: {
      Authorization: `Bearer ${session.data.session.access_token}`,
      "x-space-id": spaces[1 - index], "x-person-id": created[1 - index],
    } } });
    const result = await forged.from("pages").select("id").limit(1);
    assert.ok(result.error, "Forged space/person headers must not bypass account ownership");
  }
  console.log("Both accounts reject cross-account space access, including forged person headers.");
} finally {
  for (const client of clients) await client.auth.signOut().catch(() => {});
  // Only records belonging to accounts created by this script are removed.
  for (const id of created) {
    assert.match(id, /^[0-9a-f-]{36}$/);
    await target.query(`begin;
      delete from public.workspace_settings where space_id in (select id from public.spaces where owner_id='${id}');
      delete from public.error_log where space_id in (select id from public.spaces where owner_id='${id}');
      delete from public.domain_tabs where space_id in (select id from public.spaces where owner_id='${id}');
      delete from public.spaces where owner_id='${id}';
      commit;`);
    const result = await admin.auth.admin.deleteUser(id);
    if (result.error) throw result.error;
  }
  await target.close();
  console.log("Temporary accounts and spaces removed.");
}
