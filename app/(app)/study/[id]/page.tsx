import { notFound } from "next/navigation";
import { z } from "zod";
import { ReadingPane } from "@/components/shell";
import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { requireModule } from "@/lib/modules";
import { readStudySets } from "@/lib/study/service";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { StudySetView } from "./StudySetView";

export const dynamic = "force-dynamic";

// STUDY SET (/study/[id]): Practice, Progress and Questions for one set, with the person's own levels.
// Questions whose claim changed are flagged stale here and rebuilt by the page as it opens.
export default async function StudySetPage({ params }: { params: Promise<{ id: string }> }) {
  const db = supabaseRpc(getAdminSupabase());
  await requireModule("study", db);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const user = await requireUser();
  const data = await readStudySets(db, user.id, id.data);
  const set = data.sets[0];
  if (!set) notFound();
  return (
    <ReadingPane title={set.title}>
      <StudySetView set={set} data={data} />
    </ReadingPane>
  );
}
