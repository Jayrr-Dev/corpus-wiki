import { BrainCircuit, ChartNoAxesCombined, CircleDollarSign, LockKeyhole, SlidersHorizontal, ToggleRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ReadingPane } from "@/components/shell";
import { CostTable } from "@/components/usage/CostTable";
import { UsagePanel } from "@/components/usage/UsagePanel";
import { ArticleCharterForm } from "./ArticleCharterForm";
import { AutoUpdateStale } from "./AutoUpdateStale";
import { ExternalKnowledge } from "./ExternalKnowledge";
import { loadArticleCharter, loadAutoUpdateStale, loadExternalKnowledge, loadModelSettings, loadMyProfile } from "./loadModelSettings";
import { ModelPicker } from "./ModelPicker";
import { NameForm } from "./NameForm";
import { PasswordForm } from "./PasswordForm";
import { SettingHint } from "./SettingHint";
import { SettingsTabs } from "./SettingsTabs";
import { TimeZonePicker } from "./TimeZonePicker";

export const dynamic = "force-dynamic";

const sections = [
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "intelligence", label: "Intelligence", icon: BrainCircuit },
  { id: "features", label: "Features", icon: ToggleRight },
  { id: "security", label: "Security", icon: LockKeyhole },
  { id: "usage", label: "Usage & activity", icon: ChartNoAxesCombined },
  { id: "costs", label: "AI costs", icon: CircleDollarSign },
];

// Every IANA zone the runtime knows, UTC first (listed on the server so both renders match)
function timeZones(): string[] {
  return ["UTC", ...Intl.supportedValuesOf("timeZone").filter((zone) => zone !== "UTC")];
}

function SettingsCard({ id, title, description, icon: Icon, children }: {
  id: string; title: string; description: string; icon: LucideIcon; children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="min-w-0 rounded-2xl border bg-background shadow-sm">
      <header className="flex items-start gap-3 border-b px-5 py-5 sm:px-6">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border bg-sidebar text-muted-foreground"><Icon size={17} aria-hidden="true" /></span>
        <div><h2 id={`${id}-title`} className="text-sm font-semibold">{title}</h2><p className="mt-1 text-panel text-muted-foreground">{description}</p></div>
      </header>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const [modelSettings, autoUpdateStale, profile, externalKnowledge, articleCharter] = await Promise.all([loadModelSettings(), loadAutoUpdateStale(), loadMyProfile(), loadExternalKnowledge(), loadArticleCharter()]);
  const panels: Record<string, ReactNode> = {
    preferences: (
      <SettingsCard id="preferences" title="Workspace preferences" description="Keep your knowledge fresh, on your terms." icon={SlidersHorizontal}>
        <div className="mb-6 border-b pb-6"><NameForm name={profile.name} email={profile.email} /></div>
        <TimeZonePicker zones={timeZones()} />
      </SettingsCard>
    ),
    intelligence: (
      <SettingsCard id="intelligence" title="Intelligence" description="Fine-tune the AI behind your second brain." icon={BrainCircuit}>
        <div className="mb-5 flex items-center gap-1.5"><h3 className="font-medium">AI model</h3><SettingHint>Used for uploads, line edits, and page builds.</SettingHint></div>
        <ModelPicker settings={modelSettings} />
        <div className="mt-6 border-t pt-6">
          <div className="mb-5 flex items-center gap-1.5"><h3 className="font-medium">Article charter</h3><SettingHint>Steers which subjects get their own article. Leave Purpose empty and new articles are not checked against it.</SettingHint></div>
          <ArticleCharterForm charter={articleCharter} />
        </div>
      </SettingsCard>
    ),
    features: (
      <SettingsCard id="features" title="Features" description="Choose what your second brain does on its own." icon={ToggleRight}>
        <AutoUpdateStale enabled={autoUpdateStale} />
        <div className="mt-6 border-t pt-6"><ExternalKnowledge enabled={externalKnowledge.enabled} ready={externalKnowledge.ready} /></div>
      </SettingsCard>
    ),
    security: <SettingsCard id="security" title="Security" description="Keep your account protected with a strong password." icon={LockKeyhole}><PasswordForm /></SettingsCard>,
    usage: <SettingsCard id="usage" title="Usage & activity" description="A closer look at your AI calls and token consumption." icon={ChartNoAxesCombined}><UsagePanel /></SettingsCard>,
    costs: <SettingsCard id="costs" title="AI costs" description="What each model costs per million tokens, and what you've spent." icon={CircleDollarSign}><CostTable activeModel={modelSettings.activeModel} /></SettingsCard>,
  };
  return (
    <ReadingPane title="Settings">
      <p className="-mt-2 text-panel text-muted-foreground">Make this workspace work the way you think.</p>
      <div className="mt-4">
        <SettingsTabs tabs={sections.map(({ id, label, icon: Icon }) => ({ id, label, icon: <Icon size={16} aria-hidden="true" />, panel: panels[id] }))} />
      </div>
    </ReadingPane>
  );
}


