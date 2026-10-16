import { ReadingPane } from "@/components/shell";
import { GlossaryScreen } from "./GlossaryScreen";

export default function GlossaryPage() {
  return (
    <ReadingPane title="Glossary">
      <p className="text-panel text-muted-foreground">
        Jargon, technical terms, acronyms, and uncommon words from your knowledge.
        Definitions are added and updated automatically as new sources are processed.
        Open a term to see its evidence and history.
      </p>
      <GlossaryScreen />
    </ReadingPane>
  );
}
