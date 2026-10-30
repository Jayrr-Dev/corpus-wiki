import type { DbRpc } from "@/lib/db/rpc";

// UPLOAD OPTIONS: the Upload screen's switches, saved per space (supabase/migrations/20261129100000_upload_options.sql).
// They apply to every upload and module run from the moment they are saved.
export type UploadOptions = {
  // accept new root domains an upload proposes instead of waiting (the Reviewer budget still asks)
  autoApprove: boolean;
};

export const DEFAULT_UPLOAD_OPTIONS: UploadOptions = { autoApprove: false };

// Unknown or missing keys read as off
export function toUploadOptions(value: unknown): UploadOptions {
  const saved = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    autoApprove: saved.autoApprove === true,
  };
}

export async function readUploadOptions(db: DbRpc): Promise<UploadOptions> {
  return toUploadOptions(await db.call<unknown>("get_upload_options"));
}

export async function saveUploadOptions(db: DbRpc, options: UploadOptions): Promise<UploadOptions> {
  return toUploadOptions(await db.call<unknown>("set_upload_options", { p_options: toUploadOptions(options) }));
}
