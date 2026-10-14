// PUBLIC SUPABASE SETTINGS: safe in the browser (URL + publishable key only).
// Read through literal `process.env.NEXT_PUBLIC_*` so Next inlines them at build time.

export type PublicSupabaseEnv = { url: string; publishableKey: string };

// Returns the public settings, or throws a clear message when .env.local is missing them
export function getPublicSupabaseEnv(): PublicSupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local.",
    );
  }
  return { url, publishableKey };
}

// True when the public settings exist (lets the proxy skip auth in a bare build)
export function hasPublicSupabaseEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
