"use client";

import { ConfirmForm, TitleForm } from "@/app/(app)/_pages/PageForms";
import { DialogMenu } from "@/app/(app)/_pages/DialogMenu";
import type { Tables } from "@/lib/database/types";
import { removeSection, renameSection } from "@/lib/server-actions/pages";
import { ForceCreateForm } from "./ForceCreateDialog";
import { UpdateArticleForm } from "./UpdateArticleDialog";
import { IllustrateSectionForm } from "./IllustrateSectionDialog";
import { AddExternalInfoForm } from "./AddExternalInfoForm";

// SECTION MENU: "…" beside a section title with Update, Force Create, Rename, and Remove (shown on hover unless `className` says otherwise)
export function SectionMenu({ section, className = "invisible group-focus-within:visible group-hover:visible" }: { section: Tables<"sections">; className?: string }) {
  const items = [
    {
      label: "Add External Info",
      hint: "Ask Sourcer to find external sources and create cited knowledge focused on this section. Your request preapproves search and import.",
      render: (close: () => void) => <AddExternalInfoForm pageId={section.page_id} sectionId={section.id} sectionTitle={section.title} onDone={close} />,
    },
    {
      label: "Illustrate",
      hint: "Ask Composer to create or replace this section’s illustration. Optional guidance lets you steer the drawing.",
      render: (close: () => void) => <IllustrateSectionForm sectionId={section.id} title={section.title} onClose={close} />,
    },
    {
      label: "Update",
      hint: "Rewrites this section from the latest saved knowledge and AI skills. You can add a note to steer it.",
      render: (close: () => void) => (
        <UpdateArticleForm id={section.id} title={section.title} scope="section" onClose={close} />
      ),
    },
    {
      label: "Force Create",
      hint: "Builds out this section from every saved claim that fits its heading, and from the web when Settings allows it.",
      render: (close: () => void) => (
        <ForceCreateForm sectionId={section.id} title={section.title} onClose={close} />
      ),
    },
    {
      label: "Rename",
      separatorBefore: true,
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
  return <DialogMenu label={`Actions for ${section.title.toLowerCase() === "overview" ? "Introduction" : section.title}`} items={items} className={className} />;
}
