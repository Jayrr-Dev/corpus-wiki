"use client";

import { usePathname, useRouter } from "next/navigation";
import type { Tables } from "@/lib/database/types";
import { DialogMenu } from "./DialogMenu";
import { DeleteForm, RenameForm } from "./PageRowActions";

type Page = Tables<"pages">;

// PAGE MENU: "…" with Rename and Remove (sidebar rows and the page's own header)
export function PageMenu({ page, className }: { page: Page; className?: string }) {
  const leaveIfOpen = useLeaveRemovedPage(page.slug);
  const items = [
    { label: "Rename", render: (close: () => void) => <RenameForm page={page} onDone={close} /> },
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

// After a remove: leaves the page's own screen (it is no longer shown), else stays put
function useLeaveRemovedPage(slug: string): () => void {
  const router = useRouter();
  const pathname = usePathname();
  return () => {
    if (pathname === `/p/${slug}`) router.push("/");
  };
}
