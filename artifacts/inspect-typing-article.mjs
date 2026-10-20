const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
}
const rows = await query(`
  select u.id, left(coalesce(r.title,''), 80) as title, r.content
  from public.units u
  join public.revisions r on r.id = u.current_revision_id
  where u.id in (
    '53deb1b1-21f3-42be-8b04-1e816717790b',
    '4056c74f-d718-4872-88d5-f93e8a7208ee'
  )`);
console.log(JSON.stringify(rows, null, 2));
const why = await query(`
  select status, built_at is not null as built,
    (select count(*) from jsonb_array_elements_text(query->'unitIds')) as selected
  from public.sections where id = 'e845c89a-ca4d-4e24-aadc-538ac4ea5180'`);
console.log("section", JSON.stringify(why));
