import "server-only";

import { progressReporter, SECTION_BUILD_EVENT, type SectionBuildMessage, sectionBuildChannel, type SectionProgress } from "@/lib/living-page/buildProgress";
import type { AdminSupabase } from "@/lib/supabase/admin";

// =====================================================================
// SECTION BUILD BROADCAST: sends a section's build progress over Supabase
// Realtime Broadcast (HTTP, so the server never holds a socket open).
// Messages are not stored. A failed send is dropped: the progress is only a
// preview, and the committed lines arrive through the normal table feed.
// =====================================================================

export function broadcastSectionProgress(admin: AdminSupabase): (sectionId: string) => SectionProgress {
  return (sectionId) => {
    const channel = admin.channel(sectionBuildChannel(sectionId));
    let sending: Promise<unknown> = Promise.resolve();
    const send = (message: SectionBuildMessage) => {
      sending = channel.httpSend(SECTION_BUILD_EVENT, message).catch(() => undefined);
      // The last message closes the channel object once it has gone out
      if (message.kind === "done") void sending.finally(() => admin.removeChannel(channel));
    };
    return progressReporter(send);
  };
}
