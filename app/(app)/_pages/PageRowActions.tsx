"use client";

import { RowMenu } from "@/components/row-menu/RowMenu";
import type { Tables } from "@/lib/database/types";
import { deletePage, renamePage } from "@/lib/server-actions/pages";
import { ConfirmForm, TitleForm } from "./PageForms";

type Page = Tables<"pages">;

// ROW ACTIONS: "…" with Rename and Remove for one page
export function PageRowActions({ page }: { page: Page }) {
  return (
    <RowMenu
      label={page.title}
      items={[
        { label: "Rename", body: (close) => <RenameForm page={page} onDone={close} /> },
        { label: "Remove", isDestructive: true, body: (close) => <DeleteForm page={page} onDone={close} /> },
      ]}
    />
  );
}

// RENAME: new title (the URL slug stays the same); also used by the page menus
export function RenameForm({ page, onDone }: { page: Page; onDone: () => void }) {
  return (
    <TitleForm
      heading="Rename page"
      description={`The address stays /p/${page.slug}. You can undo this on the Changes screen.`}
      initialTitle={page.title}
      submitLabel="Rename"
      onSubmit={(title) => renamePage(page.id, title)}
      onDone={onDone}
    />
  );
}

// REMOVE: confirm; knowledge units are not touched; also used by the page menus
export function DeleteForm({ page, onDone }: { page: Page; onDone: () => void }) {
  return (
    <ConfirmForm
      heading={`Remove “${page.title}”?`}
      description="The page and its sections leave the wiki. The knowledge units it showed stay. You can undo this on the Changes screen."
      submitLabel="Remove"
      onSubmit={() => deletePage(page.id)}
      onDone={onDone}
    />
  );
}
