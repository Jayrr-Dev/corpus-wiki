import { preflight } from "@/lib/agents/oauth/http";
import { handleTokenRequest } from "@/lib/agents/oauth/tokenEndpoint";

// OAUTH TOKEN ENDPOINT: codes and refresh tokens become access tokens (lib/agents/oauth/tokenEndpoint.ts)
export const POST = handleTokenRequest;
export const OPTIONS = preflight;
