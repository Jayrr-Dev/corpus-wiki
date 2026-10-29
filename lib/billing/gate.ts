import type { CostedCall } from "@/lib/ai/pricing";
import type { DbRpc } from "@/lib/db/rpc";
import { type CallEstimate, creditsForCall, estimateCallCredits } from "./credits";

// =====================================================================
// USAGE GATE: runs before every chatJson call (lib/ai/chat.ts). It reserves
// an estimate of the call's credits with one atomic RPC
// (check_and_reserve_usage), then settles the real cost afterwards.
//
//   off      billing flag off: no RPC, nothing reserved, never blocks
//   log      billing on, monetization switch off: usage is counted and a
//            call that would pass a limit is only logged, never blocked
//   enforce  both on: a call past the 5-hour or weekly limit is refused
//
// The gate fails open: if the database cannot answer, the call goes ahead.
// =====================================================================

export type UsageGateMode = "off" | "log" | "enforce";

export type UsageLimitReason = "session_limit" | "weekly_limit";

// What check_and_reserve_usage answers
export type UsageDecision = {
  ok: boolean;
  // Set when a limit would be passed, also when it was only logged
  reason: UsageLimitReason | null;
  resetsAt: string | null;
  reserved: number;
  sessionStartsAt: string | null;
  weeklyStartsAt: string | null;
  userId: string | null;
};

export type UsageReservation = {
  // Records the real cost (null: unknown, the estimate stands) and returns the call's credits
  settle(actual: CostedCall | null): Promise<number | null>;
};

export type UsageGate = {
  reserve(call: CallEstimate & { purpose: string }): Promise<UsageReservation>;
};

// THE LIMIT-REACHED ERROR: interactive work shows it, with the reset time
export class UsageLimitError extends Error {
  readonly reason: UsageLimitReason;
  readonly resetsAt: string | null;
  constructor(reason: UsageLimitReason, resetsAt: string | null) {
    const window = reason === "session_limit" ? "5-hour" : "weekly";
    super(`You have used this ${window} limit.${resetsAt ? ` It resets ${new Date(resetsAt).toISOString()}.` : ""}`);
    this.name = "UsageLimitError";
    this.reason = reason;
    this.resetsAt = resetsAt;
  }
}

type GateOptions = {
  db: DbRpc;
  // Read before each call (cached for `modeTtlMs`), so turning a switch applies within seconds
  mode: () => Promise<UsageGateMode>;
  // The person billed; null bills the owner of the current space
  userId?: string | null;
  modeTtlMs?: number;
  now?: () => number;
};

// A reservation that only works out the credits, for when nothing was reserved
const unreserved: UsageReservation = { settle: async (actual) => (actual ? creditsForCall(actual) : null) };

export function createUsageGate(options: GateOptions): UsageGate {
  const ttl = options.modeTtlMs ?? 30_000;
  const now = options.now ?? Date.now;
  let cached: { mode: UsageGateMode; at: number } | null = null;

  const currentMode = async (): Promise<UsageGateMode> => {
    if (cached && now() - cached.at < ttl) return cached.mode;
    let mode: UsageGateMode;
    try {
      mode = await options.mode();
    } catch (error) {
      console.error("Billing mode could not be read; usage is not metered.", error);
      mode = "off";
    }
    cached = { mode, at: now() };
    return mode;
  };

  return {
    async reserve(call) {
      const mode = await currentMode();
      if (mode === "off") return unreserved;
      const estimate = estimateCallCredits(call);
      let decision: UsageDecision;
      try {
        decision = await options.db.call<UsageDecision>("check_and_reserve_usage", {
          p_user: options.userId ?? null,
          p_credits: estimate,
          p_enforce: mode === "enforce",
        });
      } catch (error) {
        console.error("Usage could not be reserved; the call goes ahead.", error);
        return unreserved;
      }
      if (decision.reason) {
        if (mode === "enforce" && !decision.ok) throw new UsageLimitError(decision.reason, decision.resetsAt);
        console.info(`Usage limit (${decision.reason}) would stop "${call.purpose}"; monetization is off, so it only logs.`);
      }
      if (!decision.ok) return unreserved;
      const reserved = decision.reserved ?? estimate;
      return {
        async settle(actual) {
          const credits = actual ? creditsForCall(actual) : null;
          // Unknown spend keeps the estimate, never a free call
          const delta = (credits ?? reserved) - reserved;
          if (delta !== 0 && decision.userId) {
            try {
              await options.db.call("settle_usage", {
                p_user: decision.userId,
                p_session_starts: decision.sessionStartsAt,
                p_weekly_starts: decision.weeklyStartsAt,
                p_delta: delta,
              });
            } catch (error) {
              console.error("Usage could not be settled:", error);
            }
          }
          return credits;
        },
      };
    },
  };
}

// The mode from the two switches: the billing flag first, then monetization for enforcement
export function usageGateMode(billingEnabled: boolean, monetizationEnabled: boolean): UsageGateMode {
  if (!billingEnabled) return "off";
  return monetizationEnabled ? "enforce" : "log";
}
