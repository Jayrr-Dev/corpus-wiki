// =====================================================================
// DATABASE BACKOFF: the background workers share one pause while the
// database is overloaded or unreachable, so their timers stop adding load
// while it recovers. Each failure doubles the pause (15 seconds up to 5
// minutes); the next pass that reaches the database cleanly ends it.
// =====================================================================

const FIRST_PAUSE_MS = 15_000;
const MAX_PAUSE_MS = 5 * 60_000;

type BackoffState = { failures: number; until: number };
// Kept on globalThis so every worker timer, including ones from a reloaded module, shares it
const stateKey = Symbol.for("second-brain.database-backoff");

function state(): BackoffState {
  const holder = globalThis as typeof globalThis & { [stateKey]?: BackoffState };
  return (holder[stateKey] ??= { failures: 0, until: 0 });
}

// Errors that mean the database itself is struggling, as thrown by lib/db/rpc.ts.
// A job's own failure (bad input, an AI provider error) does not pause the workers.
export function databaseUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /statement timeout|connection not available|too many (?:database )?connections|remaining connection slots|schema cache|Database request failed without error details|:\s*(?:50[234]|52[0-4])\b/i.test(message);
}

export const databaseBackoff = {
  paused(now = Date.now()): boolean {
    return now < state().until;
  },
  // Returns the pause it started, in milliseconds
  failed(now = Date.now()): number {
    const current = state();
    const pause = Math.min(MAX_PAUSE_MS, FIRST_PAUSE_MS * 2 ** Math.min(current.failures, 10));
    current.failures += 1;
    current.until = now + pause;
    console.warn(`Database is struggling; background workers pause for ${Math.round(pause / 1000)}s.`);
    return pause;
  },
  succeeded(): void {
    const current = state();
    if (current.failures > 0) console.info("Database recovered; background workers resume.");
    current.failures = 0;
    current.until = 0;
  },
};
