export const SPACE_COOKIE = "second_brain_space";
export const LEGACY_SPACE_ID = "00000000-0000-4000-8000-000000000001";
export const SPACE_CHANGED_KEY = "second-brain:space-changed";
export const isSpaceId = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export type Space = { id: string; name: string; created_at: string; owner_id: string | null; subtitle?: string | null; subtitle_for_name?: string | null };
