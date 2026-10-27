import { redirect } from "next/navigation";

export const metadata = { title: "Ask · Corpus Wiki" };
export default function LegacyAskPage() {
  redirect("/ask");
}
