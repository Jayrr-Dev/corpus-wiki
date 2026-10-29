import type { NextRequest } from "next/server";
import { handleCallback } from "@/lib/connectors/gmail/routes";

// GMAIL CALLBACK: Google's one-time code becomes stored, encrypted tokens; a 404 while gmail_import is off
export function GET(request: NextRequest): Promise<Response> {
  return handleCallback(request);
}
