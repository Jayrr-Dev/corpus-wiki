import { writeFileSync } from "node:fs";

// =====================================================================
// FETCH SAVED SOURCES (read only): the passages of the named sources, in
// the shape recordUpload takes, for offline replays such as
// reconcile-compare.ts. One PostgREST select per source; nothing written.
//
//   node --experimental-strip-types scripts/cost/fetch-sources.ts --space <space id> --ids <id,id,...> --out <file.json>
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.
// =====================================================================

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) throw new Error(`Pass --${name}.`);
  return process.argv[index + 1]!;
};
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
const headers = { apikey: key, Authorization: `Bearer ${key}`, "x-space-id": arg("space") };

const select = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${url}/rest/v1/${path}`, { headers });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
};

const out = [];
for (const id of arg("ids").split(",")) {
  const [source] = await select<{ id: string; title: string; mime_type: string; source_date: string }[]>(`sources?id=eq.${id}&select=id,title,mime_type,source_date`);
  if (!source) throw new Error(`No source ${id}.`);
  const passages = await select<{ position: number; text: string; location: unknown; hash: string; speaker_label: string | null }[]>(`passages?source_id=eq.${id}&select=position,text,location,hash,speaker_label&order=position`);
  out.push({ id, title: source.title, mimeType: source.mime_type, sourceDate: source.source_date,
    passages: passages.map((p) => ({ position: p.position, text: p.text, location: p.location, hash: p.hash, speakerLabel: p.speaker_label })) });
  console.log(`${source.title}: ${passages.length} passages, ${passages.reduce((sum, p) => sum + p.text.length, 0)} chars`);
}
writeFileSync(arg("out"), JSON.stringify(out, null, 1));
