import { ReadingPane } from "@/components/shell";
import { UploadScreen } from "./UploadScreen";

// UPLOAD (/upload): add files; each runs through the pipeline while the screen watches
export default function UploadPage() {
  return (
    <ReadingPane title="Upload">
      <UploadScreen />
    </ReadingPane>
  );
}
