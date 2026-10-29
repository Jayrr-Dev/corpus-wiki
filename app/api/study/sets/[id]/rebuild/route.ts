import { z } from "zod";
import { rebuildStaleItems, studyDeps } from "@/lib/study/service";
import { errorResponse, studyRequest } from "../../../guard";

export const maxDuration = 300;

// REBUILD STALE QUESTIONS: a set's page calls this when it opens with questions whose claim changed
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await studyRequest(request);
  if (guard instanceof Response) return guard;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response("Not found", { status: 404 });
  try {
    return Response.json(await rebuildStaleItems(studyDeps(guard.db), guard.userId, id.data));
  } catch (error) { return errorResponse(error); }
}
