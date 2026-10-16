import { Chatbot as Ask } from "../chatbot/Chatbot";
import { getServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const metadata = { title: "Ask · Second Brain" };

export default async function AskPage() {
  const client = await getServerSupabase();
  const { data } = await client.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  return <Ask key={data.claims.sub} userId={data.claims.sub} />;
}
