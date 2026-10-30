import "server-only";

import { currentAgentSession } from "@/lib/agents/session";
import { requireUser, type SignedInUser } from "@/lib/auth/requireUser";

// =====================================================================
// PLATFORM ADMIN: the people who run the app itself, as opposed to the
// members of a space. Local development counts; elsewhere the signed-in
// email must be listed in PLATFORM_ADMIN_EMAILS (comma-separated).
// =====================================================================

export function isPlatformAdmin(email: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "development") return true;
  if (!email) return false;
  const admins = (env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((entry) => entry.trim().toLowerCase());
  return admins.includes(email.trim().toLowerCase());
}

// GUARD FOR SERVER ACTIONS that change the whole app; agents never pass
export async function requirePlatformAdmin(): Promise<SignedInUser> {
  const user = await requireUser();
  if (currentAgentSession() || !isPlatformAdmin(user.email)) throw new Error("Only a platform admin can change this.");
  return user;
}
