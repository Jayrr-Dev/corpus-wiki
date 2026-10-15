import Link from "next/link";
import { Section } from "@/app/(app)/_components/bits";
import { ReadingPane } from "@/components/shell";
import { loadModelSettings } from "./loadModelSettings";
import { ModelPicker } from "./ModelPicker";
import { PasswordForm } from "./PasswordForm";

// Always fresh: the pick and Token Factory's list can change between visits
export const dynamic = "force-dynamic";

// SETTINGS (/settings): your password and the AI model the workspace uses
export default async function SettingsPage() {
  const modelSettings = await loadModelSettings();
  return (
    <ReadingPane title="Settings">
      <div className="flex flex-col gap-8">
        <Section title="Password">
          <PasswordForm />
        </Section>
        <Section title="AI skills"><p className="text-panel">Choose instructions for each AI stage in the <Link href="/skills" className="text-link hover:underline">Skills workspace</Link>.</p></Section>
        <Section title="AI model">
          <ModelPicker settings={modelSettings} />
        </Section>
      </div>
    </ReadingPane>
  );
}
