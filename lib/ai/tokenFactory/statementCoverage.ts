// A model can answer with one claim for a passage of seven facts: nothing fails, and six facts are
// gone with the upload marked applied. So the statements in a batch are counted, and an answer with
// fewer than half as many claims is asked once more.
const MIN_WORDS = 4;
const MIN_STATEMENTS = 4;

export function statementCount(passages: { text: string }[]): number {
  return passages.flatMap((passage) => passage.text.split(/(?<=[.!?])\s+|\n+/))
    .filter((text) => text.trim().split(/\s+/).length >= MIN_WORDS).length;
}

// The statements the batch holds when the answer looks short of them, or 0 when it is fine
export function missedStatements(passages: { text: string }[], claims: number): number {
  const statements = statementCount(passages);
  return statements >= MIN_STATEMENTS && claims * 2 < statements ? statements : 0;
}

export const askForEveryStatement = (claims: number, statements: number) => ({ role: "user" as const,
  content: `You returned ${claims} claim(s), but these passages hold about ${statements} statements. Answer again in full, with one claim for every statement. A similar unit about a different organization, place or person is not the same knowledge: add a new claim for it.` });

// Asks again when the answer is short, and keeps whichever answer has more claims
export async function withEveryStatement<A extends { value: { claims: unknown[] } }>(answer: A, passages: { text: string }[],
  ask: (note: ReturnType<typeof askForEveryStatement>) => Promise<A>): Promise<A> {
  const statements = missedStatements(passages, answer.value.claims.length);
  if (!statements) return answer;
  console.warn("Extraction looked short; asking again", { claims: answer.value.claims.length, statements });
  const again = await ask(askForEveryStatement(answer.value.claims.length, statements));
  return again.value.claims.length > answer.value.claims.length ? again : answer;
}
