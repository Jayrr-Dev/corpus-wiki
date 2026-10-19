import "server-only";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/requireUser";
import { resetRequestActor } from "@/lib/auth/currentPerson";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { SPACE_COOKIE, type Space } from "./shared";

export async function readMySpaces(): Promise<{ spaces: Space[]; activeSpace: Space; account: { id: string; email: string | null } }> {
  const account = await requireUser();
  const first = await supabaseRpc(getAdminSupabase()).call<Space>("ensure_my_space");
  const { data, error } = await (await getServerSupabase()).from("spaces").select("*").order("created_at").order("id");
  if (error) throw new Error(error.message);
  const spaces = data ?? [first];
  const selected = (await cookies()).get(SPACE_COOKIE)?.value;
  const activeSpace = spaces.find((space) => space.id === selected) ?? first;
  if (activeSpace.owner_id !== account.id) throw new Error("This space belongs to another account.");
  return { spaces, activeSpace, account };
}

export async function selectOwnedSpace(id: string): Promise<void> {
  await requireUser();
  const { data, error } = await (await getServerSupabase()).from("spaces").select("id").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Space not found or not owned by you.");
  (await cookies()).set(SPACE_COOKIE, id, { path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
  await resetRequestActor();
}
