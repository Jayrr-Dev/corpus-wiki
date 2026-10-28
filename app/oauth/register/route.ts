import { preflight } from "@/lib/agents/oauth/http";
import { handleRegisterRequest } from "@/lib/agents/oauth/registerEndpoint";

// OAUTH DYNAMIC CLIENT REGISTRATION (RFC 7591)
export const POST = handleRegisterRequest;
export const OPTIONS = preflight;
