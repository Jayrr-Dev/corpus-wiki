import { ReadingPane } from "@/components/shell";
import { CreatePageDialog } from "../_pages/CreatePageDialog";
import { PagesHome } from "../_pages/PagesHome";
import { WikiUpdatesDialog } from "../_pages/WikiUpdatesDialog";

// PAGES (/pages): every wiki page; create, rename and delete them here
export default function PagesIndexPage() {
  return (
    <ReadingPane title="Wiki" actions={<div className="flex items-center gap-2"><WikiUpdatesDialog /><CreatePageDialog /></div>}>
      <PagesHome />
    </ReadingPane>
  );
}
