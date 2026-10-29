import { requireUser } from "@/lib/auth/requireUser";
import { moduleOffResponse } from "@/lib/modules";
import { listVoices } from "@/lib/video/server";

export const dynamic = "force-dynamic";

// VOICES for the New video form: the account's ElevenLabs voices with their preview clips
export async function GET(): Promise<Response> {
  try { await requireUser(); } catch { return Response.json({ error: "Not signed in." }, { status: 401 }); }
  const off = await moduleOffResponse("video");
  if (off) return off;
  return Response.json({ voices: await listVoices() }, { headers: { "Cache-Control": "private, max-age=300" } });
}
