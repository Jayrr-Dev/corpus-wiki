import "server-only";

import { LandingNav } from "@/components/landing/landing-nav";
import { requestClaims } from "@/lib/auth/claims";

// A session that cannot be read counts as signed out: the page stays public
async function isSignedIn(): Promise<boolean> {
  try {
    const { data, error } = await requestClaims();
    return !error && typeof data?.claims?.sub === "string";
  } catch {
    return false;
  }
}

// SITE NAV: the landing nav, told on the server whether this visitor is signed in,
// so the page arrives with the right button instead of swapping it after load
export async function SiteNav({ onHome = true }: { onHome?: boolean }) {
  return <LandingNav onHome={onHome} signedIn={await isSignedIn()} />;
}
