import { ReadingPane } from "@/components/shell";
import { CreatePageDialog } from "./_pages/CreatePageDialog";
import { PagesHome } from "./_pages/PagesHome";

// PAGES (/): every wiki page; create, rename and delete them here
export default function PagesIndexPage() {
  return (
    <ReadingPane title="Pages" actions={<CreatePageDialog />}>
      <PagesHome />
    </ReadingPane>
  );
}
