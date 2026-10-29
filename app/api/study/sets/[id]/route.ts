import { z } from "zod";
import { deleteSet, renameSet, setTitleSchema } from "@/lib/study/service";
import { errorResponse, studyRequest } from "../../guard";

// RENAME (admin mode): the set's title, 1 to 200 characters
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await studyRequest(request);
  if (guard instanceof Response) return guard;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response("Not found", { status: 404 });
  const parsed = setTitleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("Give the set a title of 1 to 200 characters.");
  try {
    await renameSet(guard.db, id.data, parsed.data.title);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}

// DELETE (admin mode): removes the set with its questions and their answers; levels stay
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await studyRequest(request);
  if (guard instanceof Response) return guard;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response("Not found", { status: 404 });
  try {
    await deleteSet(guard.db, id.data);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
