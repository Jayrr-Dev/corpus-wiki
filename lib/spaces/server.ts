import "server-only";
import { cookies } from "next/headers";
import { requireUser, type SignedInUser } from "@/lib/auth/requireUser";
import { resetRequestActor } from "@/lib/auth/currentPerson";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { getServerSupabase } from "@/lib/supabase/server";
import { SPACE_COOKIE, type Space } from "./shared";

export async function readMySpaces(): Promise<{ spaces: Space[]; activeSpace: Space; account: SignedInUser }> {
  // The claims check and the owned-spaces list run together (RLS shows only the caller's live spaces)
  const [account, listed, store] = await Promise.all([requireUser(), listMySpaces(), cookies()]);
  // ensure_my_space returns the oldest owned space, which is the list's first row.
  // Only a new account has none yet: create it, then list again.
  let spaces = listed;
  let first = spaces[0];
  if (!first) {
    first = await supabaseRpc(getAdminSupabase()).call<Space>("ensure_my_space");
    spaces = await listMySpaces();
    if (spaces.length === 0) spaces = [first];
  }
  const selected = store.get(SPACE_COOKIE)?.value;
  const activeSpace = spaces.find((space) => space.id === selected) ?? first;
  if (activeSpace.owner_id !== account.id) throw new Error("This space belongs to another account.");
  return { spaces, activeSpace, account };
}

async function listMySpaces(): Promise<Space[]> {
  const { data, error } = await (await getServerSupabase()).from("spaces").select("*").order("created_at").order("id");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function selectOwnedSpace(id: string): Promise<void> {
  await requireUser();
  const { data, error } = await (await getServerSupabase()).from("spaces").select("id").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Space not found or not owned by you.");
  (await cookies()).set(SPACE_COOKIE, id, { path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
  await resetRequestActor();
}
