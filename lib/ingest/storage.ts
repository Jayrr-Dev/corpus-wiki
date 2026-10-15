import "server-only";

import { randomUUID } from "node:crypto";
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

// DIRECT UPLOADS: files the browser puts in the bucket itself (a video, too big for a Server
// Action body), under uploads/ through a one-use signed URL; the server reads, then removes them
export async function createDirectUploadUrl(extension: string): Promise<{ path: string; token: string }> {
  const { data, error } = await getAdminSupabase().storage.from(SOURCES_BUCKET).createSignedUploadUrl(`uploads/${randomUUID()}${extension}`);
  if (error) throw new Error(`Could not prepare the upload: ${error.message}`);
  return { path: data.path, token: data.token };
}

export async function readDirectUpload(path: string): Promise<Uint8Array> {
  requireDirectUploadPath(path);
  const { data, error } = await getAdminSupabase().storage.from(SOURCES_BUCKET).download(path);
  if (error) throw new Error(`The uploaded file could not be read: ${error.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

export async function removeDirectUpload(path: string): Promise<void> {
  requireDirectUploadPath(path);
  await getAdminSupabase().storage.from(SOURCES_BUCKET).remove([path]);
}

// Only a path a direct upload made can be read or removed this way, never a source's file
export function isDirectUploadPath(path: string): boolean {
  return /^uploads\/[0-9a-f-]{36}\.[a-z0-9]+$/.test(path);
}
function requireDirectUploadPath(path: string): void {
  if (!isDirectUploadPath(path)) throw new Error("That is not an uploaded file.");
}

// Removes the bytes at `path` (a source's file, when the source is deleted)
export async function removeSourceFile(path: string): Promise<void> {
  const { error } = await getAdminSupabase().storage.from(SOURCES_BUCKET).remove([path]);
  if (error) throw new Error(`The source was deleted, but its file could not be removed: ${error.message}`);
}
