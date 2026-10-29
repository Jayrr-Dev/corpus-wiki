import { z } from "zod";
import { editQuestionText, questionTextSchema, removeItem } from "@/lib/study/service";
import { errorResponse, studyRequest } from "../../guard";

// EDIT TEXT (admin mode): the question's prompt; its answer and claim stay
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await studyRequest(request);
  if (guard instanceof Response) return guard;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response("Not found", { status: 404 });
  const parsed = questionTextSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("The question cannot be empty.");
  try {
    await editQuestionText(guard.db, id.data, parsed.data.prompt);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}

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
