import { redirect } from "next/navigation";

export const metadata = { title: "Ask · Second Brain" };
export default function LegacyAskPage() {
  redirect("/ask");
}
