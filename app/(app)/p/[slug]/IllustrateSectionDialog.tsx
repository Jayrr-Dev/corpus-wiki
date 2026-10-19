"use client";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { InfoIcon } from "@/components/icons";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormRow } from "@/components/actions/FormRow";
import { useServerAction } from "@/components/actions/useServerAction";
import { illustrateSection } from "@/lib/server-actions/composer";

export function IllustrateSectionForm({ sectionId, title, onClose }: { sectionId: string; title: string; onClose: () => void }) {
  const [note, setNote] = useState("");
  const noteId = useId();
  const illustrate = useServerAction(illustrateSection, { refreshTables: ["lines", "assets"], progress: { title: `Illustrating “${title}”`, detail: "Composer is drawing and reviewing this section’s illustration…" } });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (illustrate.isPending) return;
    const pending = illustrate.run(sectionId, note);
    onClose();
    const result = await pending;
    if (!result.ok) toast.error(result.error);
    else if (!result.figures) toast.info(result.message ?? "Composer could not find a supported illustration for this section.");
    else toast.success("Section illustration ready.");
  };
  return <form onSubmit={submit} className="flex flex-col gap-4">
    <DialogHeader>
      <div className="flex items-center gap-2 pr-6">
        <DialogTitle>Illustrate section</DialogTitle>
        <Tooltip content={`Create a new illustration for “${title}”.`} className="max-w-64">
          <button type="button" aria-label="About this illustration" className="inline-flex shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            <InfoIcon size={14} />
          </button>
        </Tooltip>
      </div>
      <DialogDescription className="sr-only">Create a new illustration for “{title}”.</DialogDescription>
    </DialogHeader>
    <FormRow htmlFor={noteId} label="How would you like it illustrated? (optional)">
      <Textarea id={noteId} rows={4} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe the subject, style, viewpoint, colours, or what to avoid. For example: A clean top-down SVG with the clearance marked." />
    </FormRow>
    <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={illustrate.isPending}>Illustrate</Button></DialogFooter>
  </form>;
}
