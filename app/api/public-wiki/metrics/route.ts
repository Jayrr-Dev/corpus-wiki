import { NextRequest } from "next/server";
import { metricInput } from "@/lib/publishing/validation";
import { dailyMetricHash, readMetricTicket } from "@/lib/publishing/metricTicket";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  // Requests originate inside our reader (also when framed on another site).
  // No CORS permission is granted to the embedding website.
  if (request.headers.get("origin") !== request.nextUrl.origin) return new Response(null, { status: 403, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return new Response(null, { status: 415, headers });
  if (Number(request.headers.get("content-length") ?? 0) > 4000) return new Response(null, { status: 413, headers });
  if (/bot|crawler|spider|headless|preview|slurp/i.test(request.headers.get("user-agent") ?? "")) return new Response(null, { status: 204, headers });
  // Bound streamed bodies too; Content-Length is not trusted.
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400, headers });
  let raw = "";
  let size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4000) { await reader.cancel(); return new Response(null, { status: 413, headers }); }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    const input = metricInput.safeParse(JSON.parse(raw));
    if (!input.success) return new Response(null, { status: 400, headers });
    const ticket = readMetricTicket(input.data.ticket);
    if (!ticket) return new Response(null, { status: 403, headers });
    // IP addresses are never stored. This short-lived hash only limits floods.
    // Trust the deployment's forwarded address; use the session if unavailable.
    const address = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? input.data.visitor;
    await supabaseRpc(getAdminSupabase()).call("record_public_wiki_event", {
      p_slug: ticket.slug, p_page: ticket.page, p_edition: ticket.edition,
      p_visitor: dailyMetricHash("visitor", input.data.visitor), p_rate: dailyMetricHash("rate", address),
      p_surface: ticket.surface, p_channel: ticket.channel, p_kind: input.data.kind,
    });
    return new Response(null, { status: 204, headers });
  } catch {
    return new Response(null, { status: 400, headers });
  }
}
