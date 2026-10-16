import { ReadingPane } from "@/components/shell";
import { AutoDescribeEntities } from "../graph/AutoDescribeEntities";
import { EntitiesPageMenu, EntitiesTable } from "./EntitiesTable";
import { NewEntityButton } from "./NewEntityButton";

type EntitiesPageProps = { searchParams: Promise<{ retired?: string }> };

// ENTITIES (/entities): the real things claims are about; ?retired=1 also lists retired ones
export default async function EntitiesPage({ searchParams }: EntitiesPageProps) {
  const showRetired = (await searchParams).retired === "1";
  return (
    <ReadingPane
      title="Entities"
      actions={
        <div className="flex items-center gap-1">
          <NewEntityButton />
          <EntitiesPageMenu showRetired={showRetired} />
        </div>
      }
    >
      <AutoDescribeEntities />
      <EntitiesTable showRetired={showRetired} />
    </ReadingPane>
  );
}
