import type { NextRequest } from "next/server";
import { handleConnect } from "@/lib/connectors/gmail/routes";

// GMAIL CONNECT: to Google's consent screen (read-only Gmail); a 404 while gmail_import is off
export function GET(request: NextRequest): Promise<Response> {
  return handleConnect(request);
}
