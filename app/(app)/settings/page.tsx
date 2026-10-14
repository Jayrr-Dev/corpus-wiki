import { Section } from "@/app/(app)/_components/bits";
import { ReadingPane } from "@/components/shell";
import { UsagePanel } from "@/components/usage/UsagePanel";
import { loadModelSettings } from "./loadModelSettings";
import { ModelPicker } from "./ModelPicker";
import { PasswordForm } from "./PasswordForm";

// Always fresh: the pick and Token Factory's list can change between visits
export const dynamic = "force-dynamic";

// SETTINGS (/settings): your password, the AI model the workspace uses, and its token usage
export default async function SettingsPage() {
  const modelSettings = await loadModelSettings();
  return (
    <ReadingPane title="Settings">
      <div className="flex flex-col gap-8">
        <Section title="Password">
          <PasswordForm />
        </Section>
        <Section title="AI model">
          <ModelPicker settings={modelSettings} />
        </Section>
        <Section title="AI usage">
          <UsagePanel />
        </Section>
      </div>
    </ReadingPane>
  );
}
