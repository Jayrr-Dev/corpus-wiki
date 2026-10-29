import { withSpaceActor } from "@/lib/auth/currentPerson";
import { moduleOffResponse } from "@/lib/modules";
import { handleRenderedCallback } from "@/lib/video/callback";
import { videoStore } from "@/lib/video/server";

export const runtime = "nodejs";

// RENDER CALLBACK: the Nebius render job posts here when the MP4 and poster are uploaded, or when it
// failed. Signed out (lib/supabase/proxy.ts lets it through); the signed token in Authorization is the check.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return handleRenderedCallback(request, id, {
    secret: process.env.VIDEO_CALLBACK_SECRET ?? "",
    inSpace: (claims, work) => withSpaceActor({ personId: null, via: "script", spaceId: claims.spaceId }, work),
    moduleOff: () => moduleOffResponse("video"),
    store: () => videoStore(),
  });
}
