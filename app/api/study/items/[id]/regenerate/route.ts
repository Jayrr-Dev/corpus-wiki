import { z } from "zod";
import { regenerateItem, studyDeps } from "@/lib/study/service";
import { errorResponse, studyRequest } from "../../../guard";

export const maxDuration = 60;

// REGENERATE (Questions tab): the Tutor writes the question again from its claim's current revision
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await studyRequest(request);
  if (guard instanceof Response) return guard;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response("Not found", { status: 404 });
  try {
    await regenerateItem(studyDeps(guard.db), guard.userId, id.data);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
