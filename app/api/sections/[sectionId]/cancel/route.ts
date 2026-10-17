import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";

// Independent of the browser's serial Server Action queue, so cancellation
// reaches the database while the action doing the rewrite is still awaiting AI.
export async function POST(request: Request, { params }: { params: Promise<{ sectionId: string }> }): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ ok: false, error: "Invalid request origin." }, { status: 403 });
  try { await requireUser(); }
  catch { return Response.json({ ok: false, error: "Sign in to cancel updates." }, { status: 401 }); }
  const parsed = z.uuid().safeParse((await params).sectionId);
  if (!parsed.success) return Response.json({ ok: false, error: "Invalid section." }, { status: 400 });
  try {
    await supabaseRpc(getAdminSupabase()).call("cancel_section_build", { p_section_id: parsed.data });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Could not cancel this update." }, { status: 500 });
  }
}
