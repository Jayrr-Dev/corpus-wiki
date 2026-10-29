import { GraduationCap } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { ReadingPane } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { loadScopeOptions, SCOPE_KIND_LABELS } from "@/lib/knowledge/scope";
import { requireModule } from "@/lib/modules";
import { readStudySets } from "@/lib/study/service";
import { summarizeSets } from "@/lib/study/session";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { CoverageBar, LevelBar } from "./LevelBar";
import { NewSetButton } from "./NewSetDialog";

export const dynamic = "force-dynamic";

// STUDY (/study): practice questions built from the wiki's knowledge (docs/knowledge-modules-plan.md).
// Due today across every set, then each set with its coverage reached, due count and levels.
// 404 while the module is off in Settings → Features.
export default async function StudyPage() {
  const db = supabaseRpc(getAdminSupabase());
  await requireModule("study", db);
  const user = await requireUser();
  const [data, options] = await Promise.all([readStudySets(db, user.id), loadScopeOptions()]);
  const { sets, due } = summarizeSets(data, new Date());
  return (
    <ReadingPane title="Study" actions={<NewSetButton options={options} />}>
      {sets.length ? (
        <>
          <div className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3">
            <span className="font-medium">Due today: {due}</span>
            {due ? <Button asChild size="sm"><Link href="/study/review">Start review</Link></Button> : <Button size="sm" disabled>Start review</Button>}
          </div>
          <ul className="grid gap-3">
            {sets.map((set) => (
              <li key={set.id}>
                <Link href={`/study/${set.id}`} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl border px-4 py-3 hover:bg-muted/50">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{set.title}</span>
                    <Badge variant="outline">{SCOPE_KIND_LABELS[set.scopeKind]}</Badge>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <CoverageBar percent={set.practicedPct} />
                    <span className="text-panel text-muted-foreground">{set.due} due</span>
                    <LevelBar levels={set.levels} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState icon={GraduationCap} title="No study sets yet." />
      )}
    </ReadingPane>
  );
}
