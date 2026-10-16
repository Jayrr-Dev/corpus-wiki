import { Chatbot } from "./Chatbot";
import { getServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const metadata = { title: "Ask · Second Brain" };
export default async function ChatbotPage() {
  const client = await getServerSupabase();
  const { data } = await client.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  return <Chatbot key={data.claims.sub} userId={data.claims.sub} />;
}
