import { requireUser } from "@/lib/auth/requireUser";
import { cancelUploadEvent } from "@/lib/ingest";

// =====================================================================
// CANCEL AN UPLOAD: a route, not a Server Action, because the browser runs
// its Server Actions one at a time and the upload being cancelled is one.
// The running role stops at its next check and its AI call is aborted.
// =====================================================================

export async function POST(_request: Request, { params }: { params: Promise<{ eventId: string }> }): Promise<Response> {
  try {
    await requireUser();
  } catch {
    return Response.json({ ok: false, error: "Sign in to cancel uploads." }, { status: 401 });
  }
  const { eventId } = await params;
  try {
    return Response.json({ ok: true, outcome: await cancelUploadEvent(eventId) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
