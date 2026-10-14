"use client";

import { ConfirmForm, TitleForm } from "@/app/(app)/_pages/PageForms";
import { DialogMenu } from "@/app/(app)/_pages/DialogMenu";
import type { Tables } from "@/lib/database/types";
import { removeSection, renameSection } from "@/lib/server-actions/pages";

// SECTION MENU: "…" beside a section title with Rename and Remove (shown on hover)
export function SectionMenu({ section }: { section: Tables<"sections"> }) {
  const items = [
    {
      label: "Rename",
      render: (close: () => void) => (
        <TitleForm
          heading="Rename section"
          description="You can undo this on the Changes screen."
          initialTitle={section.title}
          submitLabel="Rename"
          onSubmit={(title) => renameSection(section.id, title)}
          onDone={close}
        />
      ),
    },
    {
      label: "Remove",
      isDestructive: true,
      render: (close: () => void) => (
        <ConfirmForm
          heading={`Remove “${section.title}”?`}
          description="The section and its lines leave the page. The knowledge units stay. You can undo this on the Changes screen."
          submitLabel="Remove"
          onSubmit={() => removeSection(section.id)}
          onDone={close}
        />
      ),
    },
  ];
  return <DialogMenu label={`Actions for ${section.title}`} items={items} className="invisible group-focus-within:visible group-hover:visible" />;
}
