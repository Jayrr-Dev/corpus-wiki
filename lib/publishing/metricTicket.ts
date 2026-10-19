import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { publicationSlug } from "./validation";

const ticketSchema = z.object({ slug: publicationSlug, page: z.string().min(1).max(500), edition: z.uuid(), surface: z.enum(["site", "embed"]), channel: z.enum(["direct", "explore", "embed"]), expires: z.number().int() });
export type MetricTicket = z.infer<typeof ticketSchema>;
function sign(value: string) {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("Server metrics key is unavailable.");
  return createHmac("sha256", key).update(`public-wiki:${value}`).digest("hex");
}
export function makeMetricTicket(input: Omit<MetricTicket, "expires">, now = Date.now()): string {
  const data = Buffer.from(JSON.stringify({ ...input, expires: Math.floor(now / 1000) + 3600 })).toString("base64url");
  return `${data}.${sign(`ticket:${data}`)}`;
}
export function readMetricTicket(value: string, now = Date.now()): MetricTicket | null {
  if (value.length > 2500) return null;
  const [data, signature, extra] = value.split(".");
  if (!data || !signature || extra || !/^[a-f0-9]{64}$/.test(signature)) return null;
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(sign(`ticket:${data}`), "hex"))) return null;
  try {
    const parsed = ticketSchema.safeParse(JSON.parse(Buffer.from(data, "base64url").toString()));
    if (!parsed.success || parsed.data.expires <= Math.floor(now / 1000) || parsed.data.expires > Math.floor(now / 1000) + 3600) return null;
    return parsed.data;
  } catch { return null; }
}
export function dailyMetricHash(kind: "visitor" | "rate", value: string, now = new Date()): string {
  return sign(`${kind}:${now.toISOString().slice(0, 10)}:${value}`);
}
