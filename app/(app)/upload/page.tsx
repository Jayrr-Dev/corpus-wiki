import { ReadingPane } from "@/components/shell";
import { supabaseRpc } from "@/lib/db/rpc";
import { readUploadOptions } from "@/lib/ingest/uploadOptions";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { UploadScreen } from "./UploadScreen";

// UPLOAD (/upload): add files; each runs through the pipeline while the screen watches
export default async function UploadPage() {
  const options = await readUploadOptions(supabaseRpc(getAdminSupabase()));
  return (
    <ReadingPane title="Upload">
      <UploadScreen initialOptions={options} />
    </ReadingPane>
  );
}
