// SERVER ACTION RESULT: what every write action returns to the screen
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

// Runs a server action body and turns a thrown error into { ok: false } for the screen
export async function toActionResult<T extends object>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, ...(await run()) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
