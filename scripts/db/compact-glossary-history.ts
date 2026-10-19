// Back up every glossary audit before compacting any older record. Run without
// --apply to create the backup only; reuse it with --backup <absolute directory>.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { gzipSync, gunzipSync } from "node:zlib";
import { connectPostgres, targetFromEnvironment } from "./targets.ts";

type Row = { id: string; input: unknown; undo_state: unknown; input_hash: string; undo_hash: string };
type Manifest = { project: string; createdAt: string; beforeBytes: number; glossaryHashes: unknown; files: { name: string; sha256: string; rows: number }[] };
const args = process.argv.slice(2);
const backupAt = args.indexOf("--backup");
if (backupAt >= 0 && !args[backupAt + 1]) throw new Error("--backup requires a directory");
const backup = resolve(backupAt >= 0 ? args[backupAt + 1]! : join(homedir(), "Documents", "Backups", "second-brain-engine", `glossary-history-${new Date().toISOString().replace(/[:.]/g, "-")}`));
const db = args.includes("--direct") ? await connectPostgres(process.env.SUPABASE_DB_URL!) : await targetFromEnvironment(process.env);
const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname;
const hash = (buffer: Uint8Array) => createHash("sha256").update(buffer).digest("hex");
const literal = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;
const query = <T>(sql: string) => db.query<T>(`set jit=off; ${sql}`);
try {
 let manifest: Manifest;
 if (backupAt < 0 || (args.includes("--resume") && !existsSync(join(backup, "manifest.json")))) {
  mkdirSync(backup, { recursive: true });
  const before = await query<{ bytes: string }>("select pg_database_size(current_database()) as bytes");
  const glossaryHashes = await query("select space_id,md5(entries::text) entries,md5(identity_registry::text) registry,md5(pending_entries::text) pending,md5(definition_overrides::text) overrides from public.glossary_state order by space_id");
  manifest = { project, createdAt: new Date().toISOString(), beforeBytes: Number(before[0]!.bytes), glossaryHashes, files: [] };
  let cursor = "00000000-0000-0000-0000-000000000000";
  let count = 0;
  if (args.includes("--resume")) {
   for (const name of readdirSync(backup).filter((name) => /^actions-\d+\.json\.gz$/.test(name)).sort()) {
    const buffer = readFileSync(join(backup, name));
    const rows = JSON.parse(gunzipSync(buffer).toString()) as Row[];
    manifest.files.push({ name, sha256: hash(buffer), rows: rows.length });
    cursor = rows.at(-1)!.id; count += rows.length;
   }
  }
  const compressed = args.includes("--compressed-transfer");
  const passphrase = randomBytes(32).toString("hex");
  const transferHome = join(backup, "transfer-runtime");
  const passphraseFile = join(transferHome, "passphrase");
  if (compressed) {
   mkdirSync(transferHome, { recursive: true });
   writeFileSync(passphraseFile, passphrase, { mode: 0o600 });
  }
  while (true) {
   const sql = `select a.*,md5(input::text) input_hash,md5(undo_state::text) undo_hash from public.actions a where type::text='glossary_update' and id>${literal(cursor)}::uuid order by id limit 5`;
   let rows: Row[];
   if (compressed) {
    // pgcrypto compresses the transfer before encryption. Final backup files
    // remain ordinary gzip JSON and do not depend on GPG or this random key.
    const encrypted = await query<{ payload: string | null }>(`select encode(extensions.pgp_sym_encrypt((select jsonb_agg(t)::text from (${sql}) t),${literal(passphrase)},'compress-algo=2'),'base64') payload`);
    if (!encrypted[0]?.payload) break;
    const decrypted = spawnSync(process.env.GPG_PATH ?? "C:/Program Files/Git/usr/bin/gpg.exe", ["--batch", "--quiet", "--no-options", "--homedir", transferHome, "--pinentry-mode", "loopback", "--passphrase-file", passphraseFile, "--decrypt"],
     { input: Buffer.from(encrypted[0].payload, "base64"), maxBuffer: 128 * 1024 * 1024, windowsHide: true });
    if (decrypted.status !== 0) throw new Error(`Compressed backup transfer failed: ${decrypted.stderr?.toString() ?? decrypted.error?.message}`);
    rows = JSON.parse(decrypted.stdout.toString()) as Row[];
   } else rows = await query<Row>(sql);
   if (!rows.length) break;
   const buffer = gzipSync(JSON.stringify(rows));
   const name = `actions-${String(manifest.files.length).padStart(4, "0")}.json.gz`;
   writeFileSync(join(backup, name), buffer, { flag: "wx" });
   const saved = readFileSync(join(backup, name));
   if (hash(saved) !== hash(buffer) || JSON.stringify(JSON.parse(gunzipSync(saved).toString())) !== JSON.stringify(rows)) throw new Error("Backup verification failed");
   manifest.files.push({ name, sha256: hash(buffer), rows: rows.length });
   cursor = rows.at(-1)!.id; count += rows.length;
   console.log(`Backed up and verified ${count} records`);
  }
  if (compressed) unlinkSync(passphraseFile);
  writeFileSync(join(backup, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
  console.log(`Verified backup: ${backup} (${count} records)`);
 } else {
  manifest = JSON.parse(readFileSync(join(backup, "manifest.json"), "utf8")) as Manifest;
 }
 if (manifest.project !== project) throw new Error("Backup belongs to another project");
 const originals = new Map<string, Row>();
 for (const file of manifest.files) {
  const buffer = readFileSync(join(backup, file.name));
  if (hash(buffer) !== file.sha256) throw new Error(`Backup checksum mismatch: ${file.name}`);
  const rows = JSON.parse(gunzipSync(buffer).toString()) as Row[];
  if (rows.length !== file.rows) throw new Error("Backup row count mismatch");
  for (const row of rows) originals.set(row.id, row);
 }
 if (args.includes("--apply")) {
  const measure = () => query(`select pg_database_size(current_database()) as database_bytes,
   sum(coalesce(pg_column_size(input),0)+coalesce(pg_column_size(undo_state),0)) as glossary_payload_bytes,
   count(*) filter(where input ? 'glossaryDelta') as compacted_records from public.actions where type='glossary_update'`);
  const before = await measure();
  const candidates = await query<{ id: string }>(`select id from (select id,input,row_number() over(partition by space_id order by created_at desc,id desc) as n from public.actions where type::text='glossary_update') a where n>20 and right(id::text,1)<>'0' and not input ? 'glossaryDelta' order by id`);
  let changed = 0;
  for (const { id } of candidates) {
   const original = originals.get(id);
   if (!original) throw new Error(`Record ${id} was not backed up; create a fresh backup`);
   const result = await query<{ id: string; compacted: boolean }>(`with candidate as materialized (
    select a.id,change_control.compact_glossary_history(a.input,a.undo_state) as compacted from public.actions a
    where a.id=${literal(id)}::uuid and md5(a.input::text)=${literal(original.input_hash)} and md5(a.undo_state::text)=${literal(original.undo_hash)} for update
   ) update public.actions a set input=c.compacted->'input',undo_state=c.compacted->'undo_state' from candidate c where a.id=c.id returning a.id,a.input ? 'glossaryDelta' as compacted`);
   if (!result.length) throw new Error(`Record ${id} changed since backup; stopped without overwriting it`);
   if (result[0]!.compacted) changed++;
   if (changed > 0 && changed % 20 === 0) console.log(`Compacted ${changed} records; each passed reconstruction verification`);
  }
  const after = await measure();
  const glossaryHashes = await query("select space_id,md5(entries::text) entries,md5(identity_registry::text) registry,md5(pending_entries::text) pending,md5(definition_overrides::text) overrides from public.glossary_state order by space_id");
  const report = { changed, before, after, glossaryUnchangedSinceBackup: JSON.stringify(glossaryHashes) === JSON.stringify(manifest.glossaryHashes), backup, finishedAt: new Date().toISOString() };
  writeFileSync(join(backup, `result-${Date.now()}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
 }
} finally { await db.close(); }
