const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const sectionId = "e845c89a-ca4d-4e24-aadc-538ac4ea5180";
const unitId = "53deb1b1-21f3-42be-8b04-1e816717790b";
const suggestionId = "eb1ffada-35a1-4e02-89be-5bdba9da8700";
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
const cited = await query(`
  select count(*)::int as n
  from public.lines l
  join public.line_revisions lr on lr.id = l.current_revision_id
  join public.revisions r on r.id = any(lr.unit_revision_ids)
  where l.section_id = '${sectionId}' and l.retired_at is null and r.unit_id = '${unitId}'`);
console.log("cited", JSON.stringify(cited));
if (cited[0]?.n) throw new Error("Claim is cited; leaving the section alone.");
const updated = await query(`
  with next_ids as (
    select coalesce(jsonb_agg(to_jsonb(id)), '[]'::jsonb) as ids
    from jsonb_array_elements_text((select query->'unitIds' from public.sections where id = '${sectionId}')) id
    where id <> '${unitId}'
  ), removed as (
    update public.sections
    set query = jsonb_set(query, '{unitIds}', (select ids from next_ids)), status = 'current', building_since = null
    where id = '${sectionId}'
      and query->'unitIds' ? '${unitId}'
    returning id
  ), suggestion as (
    update public.article_suggestions
    set status = 'applied', lease_token = null, lease_until = null, result_page_id = page_id,
      note = 'The section already states this, so it was taken off the section''s claim list.'
    where id = '${suggestionId}' and status in ('failed', 'accepting')
    returning id, status
  )
  select (select count(*) from removed) as sections, (select status from suggestion) as suggestion`);
console.log("updated", JSON.stringify(updated));
