import { ReadingPane } from "@/components/shell";
import { ExceptionsScreen } from "./ExceptionsScreen";

// EXCEPTIONS (/exceptions): what the checks could not decide; open ones first
export default function ExceptionsPage() {
  return (
    <ReadingPane title="Exceptions" width="wide">
      <ExceptionsScreen />
    </ReadingPane>
  );
}
