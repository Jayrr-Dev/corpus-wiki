const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    query: `update public.article_suggestions
      set status = 'dismissed', lease_token = null, lease_until = null, decided_at = now()
      where id = '4b5fb0bc-ba60-42ee-89ac-6a3322cf247d' and status = 'failed'
      returning id, status, left(note, 120) as note`,
  }),
});
const body = await response.json().catch(() => null);
if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
console.log(JSON.stringify(body));
