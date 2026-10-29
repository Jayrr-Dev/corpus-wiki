import "server-only";
import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc, type DbRpc } from "@/lib/db/rpc";
import { moduleOffResponse } from "@/lib/modules";
import { getAdminSupabase } from "@/lib/supabase/admin";

// STUDY ROUTE GUARD: same-origin writes from a signed-in person, and 404 while Study is off.
// Returns the person and the database port, or the response to send instead.
export async function studyRequest(request: Request): Promise<{ userId: string; db: DbRpc } | Response> {
  if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin) return new Response("Forbidden", { status: 403 });
  let userId: string;
  try { userId = (await requireUser()).id; } catch { return new Response("Not signed in", { status: 401 }); }
  const db = supabaseRpc(getAdminSupabase());
  const off = await moduleOffResponse("study", db);
  return off ?? { userId, db };
}

// A failed call as JSON the screens show as is
export function errorResponse(error: unknown, status = 400): Response {
  return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status });
}
