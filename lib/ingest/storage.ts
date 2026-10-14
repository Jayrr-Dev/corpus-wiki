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
