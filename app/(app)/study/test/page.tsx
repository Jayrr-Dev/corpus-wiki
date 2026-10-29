import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ReadingPane } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { requireModule } from "@/lib/modules";
import { LEVELS } from "@/lib/study/levels";
import { testItems } from "@/lib/study/session";
import { readStudySets } from "@/lib/study/service";
import { STUDY_KINDS } from "@/lib/study/types";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { Practice } from "../Practice";

export const dynamic = "force-dynamic";

// The query a Test sends: comma-separated set ids, levels and question types, and the section's name
const testQuery = z.object({
  sets: z.string().transform((value) => value.split(",")).pipe(z.array(z.uuid()).min(1).max(500)),
  levels: z.string().transform((value) => value.split(",")).pipe(z.array(z.enum(LEVELS)).min(1)),
  types: z.string().transform((value) => value.split(",")).pipe(z.array(z.enum(STUDY_KINDS)).min(1)),
  name: z.string().trim().min(1).max(200).catch("Study"),
  kind: z.enum(["test", "exam"]).catch("test"),
});

// TEST (/study/test): every question in the pool from the chosen sets at the chosen levels, one per claim.
// Nothing is generated; answers are recorded the same way as in Practice.
export default async function StudyTestPage({ searchParams }: { searchParams: Promise<{ sets?: string; levels?: string; types?: string; name?: string; kind?: string }> }) {
  const db = supabaseRpc(getAdminSupabase());
  await requireModule("study", db);
  const query = testQuery.safeParse(await searchParams);
  if (!query.success) redirect("/study");
  const user = await requireUser();
  const data = await readStudySets(db, user.id);
  const items = testItems(data, query.data.sets, query.data.levels, query.data.types);
  return (
    <ReadingPane title={`${query.data.kind === "exam" ? "EXAM" : "Test"}: ${query.data.name}`} actions={<Button asChild variant="ghost" size="sm"><Link href="/study">Back to Study</Link></Button>}>
      <Practice items={items} claims={data.claims} progress={data.progress} all limit={items.length} emptyText="Nothing to test at these levels." />
    </ReadingPane>
  );
}
