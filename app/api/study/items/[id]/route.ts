import { z } from "zod";
import { removeItem } from "@/lib/study/service";
import { errorResponse, studyRequest } from "../../guard";

// REMOVE (Questions tab): deletes one question; the claim's levels stay
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await studyRequest(request);
  if (guard instanceof Response) return guard;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response("Not found", { status: 404 });
  try {
    await removeItem(guard.db, id.data);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
