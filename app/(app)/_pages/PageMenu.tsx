"use client";

import { usePathname, useRouter } from "next/navigation";
import type { Tables } from "@/lib/database/types";
import { UpdateArticleForm } from "@/app/(app)/p/[slug]/UpdateArticleDialog";
import { DialogMenu, type DialogMenuItem } from "./DialogMenu";
import { DeleteForm, RenameForm } from "./PageRowActions";

type Page = Tables<"pages">;

// PAGE MENU: "…" with Rename and Remove. The sidebar also offers Update, and Update All when the page has children.
export function PageMenu({ page, className, showUpdate = false, hasChildren = false }: { page: Page; className?: string; showUpdate?: boolean; hasChildren?: boolean }) {
  const leaveIfOpen = useLeaveRemovedPage(page.slug);
  const items: DialogMenuItem[] = [
    ...(showUpdate ? updateItems(page, hasChildren) : []),
    { label: "Rename", separatorBefore: showUpdate, render: (close: () => void) => <RenameForm page={page} onDone={close} /> },
    {
      label: "Remove",
      isDestructive: true,
      render: (close: () => void) => (
        <DeleteForm
          page={page}
          onDone={() => {
            close();
            leaveIfOpen();
          }}
        />
      ),
    },
  ];
  return <DialogMenu label={`Actions for ${page.title}`} items={items} className={className} />;
}

function updateItems(page: Page, hasChildren: boolean): DialogMenuItem[] {
  const update = { label: "Update", render: (close: () => void) => <UpdateArticleForm id={page.id} title={page.title} scope="page" onClose={close} /> };
  if (!hasChildren) return [update];
  return [update, { label: "Update All", render: (close: () => void) => <UpdateArticleForm id={page.id} title={page.title} scope="tree" onClose={close} /> }];
}

// After a remove: leaves the page's own screen (it is no longer shown), else stays put
function useLeaveRemovedPage(slug: string): () => void {
  const router = useRouter();
  const pathname = usePathname();
  return () => {
    if (pathname === `/p/${slug}`) router.push("/");
  };
}
