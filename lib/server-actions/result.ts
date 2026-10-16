// SERVER ACTION RESULT: what every write action returns to the screen
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const ACTION_FAILED = "Server action failed:";

// Runs a server action body and turns a thrown error into { ok: false } for the screen
export async function toActionResult<T extends object>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, ...(await run()) };
  } catch (error) {
    // the error log files lines starting with ACTION_FAILED under "action" (lib/errors/errorLog.ts)
    console.error(ACTION_FAILED, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// A browser-side call that never reached the server (dev server restarting, offline) rejects with a TypeError
export const SERVER_UNREACHABLE_MESSAGE = "Can't reach the server right now. Check that it's running, then try again.";

// The message to show for an error thrown while calling a server action
export function describeCallError(error: unknown): string {
  if (error instanceof TypeError) return SERVER_UNREACHABLE_MESSAGE;
  return error instanceof Error ? error.message : String(error);
}
