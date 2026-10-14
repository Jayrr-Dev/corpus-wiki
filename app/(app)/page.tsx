import { ReadingPane } from "@/components/shell";
import { CreatePageDialog } from "./_pages/CreatePageDialog";
import { PagesTable } from "./_pages/PagesTable";

// PAGES (/): every wiki page; create, rename and delete them here
export default function PagesIndexPage() {
  return (
    <ReadingPane title="Pages" actions={<CreatePageDialog />}>
      <PagesTable />
    </ReadingPane>
  );
}
