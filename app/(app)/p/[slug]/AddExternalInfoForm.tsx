"use client";
import { useState } from "react";
import { toast } from "sonner";
import { DialogForm } from "@/components/actions/DialogForm";
import { useServerAction } from "@/components/actions/useServerAction";
import { Textarea } from "@/components/ui/textarea";
import { addExternalInfo } from "@/lib/server-actions/sourcer";

export function AddExternalInfoForm({ pageId, sectionId, sectionTitle, onDone }: { pageId: string; sectionId?: string; sectionTitle?: string; onDone: () => void }) {
  const [note, setNote] = useState("");
  const action = useServerAction(addExternalInfo, { progress: { title: "Adding external information", detail: "Sourcer is finding sources and creating cited knowledge…" } });
  return <DialogForm title="Add External Info" description={`Sourcer searches the web and Wikipedia${sectionTitle ? ` for “${sectionTitle}”` : ""} and adds cited knowledge. Asking preapproves the search and import.`} submitLabel="Add External Info" isPending={action.isPending} error={action.error} onSubmit={async () => {
    const task = action.run(pageId, note, sectionId);
    onDone();
    const saved = await task;
    if (!saved.ok) toast.error(saved.error);
    else if (saved.sectionsAdded) toast.success(`Article expanded: ${saved.sectionsAdded} new ${saved.sectionsAdded === 1 ? "section" : "sections"} from ${saved.sources.length} ${saved.sources.length === 1 ? "source" : "sources"}.`, { description: `${saved.knowledge} knowledge units. Completed in ${Math.round(saved.elapsedMs / 1000)} seconds.` });
    else toast.info(saved.sources.length ? "Sources saved; no additional sections passed the relevance checks." : "No new reliable sources found.");
  }}>
    <label className="space-y-2 text-sm">What should Sourcer look for? (optional)<Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} placeholder={sectionId ? "Leave blank to find useful information for this section." : "Leave blank to find useful information for this article."} /></label>
  </DialogForm>;
}
