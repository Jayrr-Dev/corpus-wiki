import { ReadingPane } from "@/components/shell";
import { requireUser } from "@/lib/auth/requireUser";
import { supabaseRpc } from "@/lib/db/rpc";
import { requireModule } from "@/lib/modules";
import { readStudySets } from "@/lib/study/service";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { Practice } from "../Practice";

export const dynamic = "force-dynamic";

// START REVIEW (/study/review): the due questions from every set, mixed, one per claim
export default async function StudyReviewPage() {
  const db = supabaseRpc(getAdminSupabase());
  await requireModule("study", db);
  const user = await requireUser();
  const data = await readStudySets(db, user.id);
  return (
    <ReadingPane title="Review">
      <Practice items={data.items} claims={data.claims} progress={data.progress} />
    </ReadingPane>
  );
}
