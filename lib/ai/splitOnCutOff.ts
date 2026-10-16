import { AnswerCutOffError, ProviderTimeoutError } from "./chat";

// A BATCH TOO BIG FOR ONE ANSWER: runs the whole batch, and when the model runs out of room
// or the provider times out, runs each half instead (recursively, in order). One item is the
// hard stop: its error is thrown. onSplit hears every error that caused a split (e.g. to count
// the tokens a cut-off answer still used).
export async function splitOnCutOff<T>(
  items: T[],
  run: (part: T[]) => Promise<void>,
  onSplit?: (error: AnswerCutOffError | ProviderTimeoutError) => void,
): Promise<void> {
  try {
    await run(items);
  } catch (error) {
    if (!(error instanceof AnswerCutOffError) && !(error instanceof ProviderTimeoutError)) throw error;
    if (items.length <= 1) throw error;
    onSplit?.(error);
    const middle = Math.ceil(items.length / 2);
    await splitOnCutOff(items.slice(0, middle), run, onSplit);
    await splitOnCutOff(items.slice(middle), run, onSplit);
  }
}
