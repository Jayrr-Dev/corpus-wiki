import "server-only";

import { getAdminSupabase } from "@/lib/supabase/admin";

// ORIGINAL FILES: the private 'sources' bucket (read later through signed URLs)
const SOURCES_BUCKET = "sources";

// Stores the bytes at `path` (hash + extension, so the same file always lands on the same path)
export async function storeSourceFile(path: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const { error } = await getAdminSupabase()
    .storage.from(SOURCES_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Could not store the file: ${error.message}`);
  return path;
}

// Removes the bytes at `path` (a source's file, when the source is deleted)
export async function removeSourceFile(path: string): Promise<void> {
  const { error } = await getAdminSupabase().storage.from(SOURCES_BUCKET).remove([path]);
  if (error) throw new Error(`The source was deleted, but its file could not be removed: ${error.message}`);
}
