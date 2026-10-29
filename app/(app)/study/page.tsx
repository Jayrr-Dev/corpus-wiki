import { GraduationCap } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { loadScopeOptions } from "@/lib/knowledge/scope";
import { requireModule } from "@/lib/modules";
import { readStudySets } from "@/lib/study/service";
import { summarizeSets } from "@/lib/study/session";
import { practicedPct, studyTree } from "@/lib/study/tree";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { NewSetButton } from "./NewSetDialog";
import { StudyTree } from "./StudyTree";

export const dynamic = "force-dynamic";

// STUDY (/study): practice questions built from the wiki's knowledge (docs/knowledge-modules-plan.md).
// Due today across every set, then each set placed on the domain tree with its coverage reached, due count and levels.
// 404 while the module is off in Settings → Features.
export default async function StudyPage() {
  const admin = getAdminSupabase();
  const db = supabaseRpc(admin);
  await requireModule("study", db);
  const user = await requireUser();
  const [data, options, domains] = await Promise.all([readStudySets(db, user.id), loadScopeOptions(), admin.from("domains").select("*").is("retired_at", null)]);
  if (domains.error) throw new Error(domains.error.message);
  const { sets, due } = summarizeSets(data, new Date());
  const { roots, other } = studyTree(domains.data, sets);
  const practiced = practicedPct(sets.reduce((sum, set) => ({ sets: 0, due: 0, claims: sum.claims + set.claims, practiced: sum.practiced + set.practiced }), { sets: 0, due: 0, claims: 0, practiced: 0 }));
  return (
    <ReadingPane title="Study" actions={<NewSetButton options={options} />}>
      {sets.length ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-muted/30 px-5 py-4">
            <div className="flex items-baseline gap-6">
              <span className="flex items-baseline gap-2"><span className="text-3xl font-semibold tabular-nums">{due}</span><span className="text-panel text-muted-foreground">due today</span></span>
              <span className="flex items-baseline gap-2"><span className="text-3xl font-semibold tabular-nums">{practiced}%</span><span className="text-panel text-muted-foreground">practiced</span></span>
            </div>
            {due ? <Button asChild><Link href="/study/review">Start review</Link></Button> : <Button disabled>Start review</Button>}
          </div>
          <StudyTree roots={roots} other={other} />
        </>
      ) : (
        <EmptyState icon={GraduationCap} title="No study sets yet." />
      )}
    </ReadingPane>
  );
}
