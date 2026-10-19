import "server-only";
import { getAdminSupabase } from "@/lib/supabase/admin";

// Overwrite the same storage object so all existing references keep working.
// Upload succeeds before metadata changes; the larger bytes are not retained.
export async function replaceStoredMedia(bucket: string, path: string, bytes: Buffer, mime: string) {
  const client = getAdminSupabase();
  const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType: mime, cacheControl: "0", upsert: true });
  if (error) throw new Error(`Could not replace the larger media file: ${error.message}`);
  const assets = await client.from("assets").update({ mime_type: mime }).eq("storage_path", bucket === "sources" ? path : `${bucket}/${path}`);
  if (assets.error) throw new Error(assets.error.message);
  if (bucket === "sources") {
    const sources = await client.from("sources").update({ mime_type: mime, byte_size: bytes.length }).eq("storage_path", path);
    if (sources.error) throw new Error(sources.error.message);
  }
}
