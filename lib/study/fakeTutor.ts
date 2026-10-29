import { vi } from "vitest";

// =====================================================================
// FAKE TUTOR FOR TESTS: stands in for the model provider by stubbing
// fetch, so the real chatJson path (role routing, schema checks, retries)
// runs with no network call. `answer` builds each reply from the request.
// =====================================================================

export type TutorRequest = { model: string; messages: { role: string; content: string }[] };
export type TutorCall = TutorRequest & { purpose: string; data: Record<string, unknown> };

// Settings that send Tutor calls to their own model, so tests can see the role was used
export const TUTOR_SETTINGS = { apiKey: "test", model: "workspace/model", roleRoutes: { tutor: { apiKey: "test", model: "tutor/model" } } };

export function stubTutor(answer: (call: TutorCall) => unknown) {
  const calls: TutorCall[] = [];
  const fetch = vi.fn(async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as TutorRequest & { response_format?: { json_schema?: { name?: string } } };
    const last = body.messages.at(-1)?.content ?? "{}";
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(last); } catch { data = {}; }
    const call = { ...body, purpose: body.response_format?.json_schema?.name ?? "", data };
    calls.push(call);
    return Response.json({ model: body.model, choices: [{ message: { content: JSON.stringify(answer(call)) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  });
  vi.stubGlobal("fetch", fetch);
  return { calls, fetch };
}

type Claim = { ref: string; title: string | null; claim: string };

// A well-formed answer to a study_questions call: one question per claim and kind
export function writeQuestions(call: TutorCall) {
  const claims = (call.data.claims ?? []) as Claim[];
  const kinds = (call.data.kinds ?? []) as string[];
  return {
    items: claims.flatMap((claim) => kinds.map((kind) => ({
      claim: claim.ref, kind, prompt: `Q ${kind} ${claim.claim}`, answer: `A ${claim.claim}`,
      wrongChoices: kind === "multiple_choice" ? ["Wrong one", "Wrong two", "Wrong three"] : [],
      explanation: `Because ${claim.claim}.`,
    }))),
  };
}
