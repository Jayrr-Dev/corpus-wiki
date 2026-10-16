import { ReadingPane } from "@/components/shell";
import { AssetsScreen } from "./AssetsScreen";

// ASSETS (/assets): the media library built from the sources
export default function AssetsPage() {
  return (
    <ReadingPane title="Assets">
      <AssetsScreen />
    </ReadingPane>
  );
}
