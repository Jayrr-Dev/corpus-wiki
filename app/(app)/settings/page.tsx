import { BrainCircuit, Bot, ChartNoAxesCombined, CircleDollarSign, Gauge, LockKeyhole, Mail, SlidersHorizontal, ToggleRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ReadingPane } from "@/components/shell";
import { InfoPopover } from "@/components/standard/info-popover";
import { CostTable } from "@/components/usage/CostTable";
import { UsagePanel } from "@/components/usage/UsagePanel";
import { AgentKeys } from "./AgentKeys";
import { AiSpeed } from "./AiSpeed";
import { ArticleCharterForm } from "./ArticleCharterForm";
import { AutoDecide } from "./AutoDecide";
import { AutoUpdateStale } from "./AutoUpdateStale";
import { getFeatureFlags } from "@/lib/flags/server";
import { loadGmailCard } from "@/lib/connectors/gmail/server";
import { ExternalKnowledge } from "./ExternalKnowledge";
import { FeatureFlags } from "./FeatureFlags";
import { type GmailOutcome, GmailImport } from "./GmailImport";
import { loadGlossaryAutoDecide, loadArticleCharter, loadAutoUpdateStale, loadExternalKnowledge, loadModelSettings, loadMonetization, loadMyProfile, loadSpeedTests } from "./loadModelSettings";
import { ModelPicker } from "./ModelPicker";
import { Monetization } from "./Monetization";
import { NameForm } from "./NameForm";
import { RoleModels } from "./RoleModels";
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
  { id: "agents", label: "Agents", icon: Bot },
  // Shown only while the gmail_import flag is on
  { id: "gmail", label: "Gmail", icon: Mail },
  { id: "usage", label: "Usage & activity", icon: ChartNoAxesCombined },
  { id: "costs", label: "AI costs", icon: CircleDollarSign },
  { id: "speed", label: "AI Speed", icon: Gauge },
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

const GMAIL_OUTCOMES: readonly string[] = ["connected", "denied", "failed", "setup"];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ gmail?: string }> }) {
  const [modelSettings, autoUpdateStale, profile, externalKnowledge, articleCharter, speedTests, glossaryAutoDecide, monetization, featureFlags, gmail] = await Promise.all([loadModelSettings(), loadAutoUpdateStale(), loadMyProfile(), loadExternalKnowledge(), loadArticleCharter(), loadSpeedTests(), loadGlossaryAutoDecide(), loadMonetization(), getFeatureFlags(), loadGmailCard()]);
  const gmailParam = (await searchParams).gmail;
  const gmailOutcome = (gmailParam && GMAIL_OUTCOMES.includes(gmailParam) ? gmailParam : null) as GmailOutcome;
  const panels: Record<string, ReactNode> = {
    preferences: (
      <SettingsCard id="preferences" title="Workspace preferences" description="Keep your knowledge fresh, on your terms." icon={SlidersHorizontal}>
        <div className="mb-6 border-b pb-6"><NameForm name={profile.name} email={profile.email} /></div>
        <TimeZonePicker zones={timeZones()} />
      </SettingsCard>
    ),
    intelligence: (
      <SettingsCard id="intelligence" title="Intelligence" description="Fine-tune the AI behind your wiki." icon={BrainCircuit}>
        <div className="mb-5 flex items-center gap-1.5"><h3 className="font-medium">AI model</h3><SettingHint>Used for uploads, line edits, and page builds.</SettingHint></div>
        <ModelPicker settings={modelSettings} />
        <div className="mt-6 border-t pt-6">
          <div className="flex items-center gap-1.5">
            <h3 className="font-medium">OpenRouter</h3>
            <InfoPopover label="About OpenRouter">
              <p>OpenRouter text and vision models show in the model pickers.</p>
              <p className="mt-2">Composer automatically assesses settled article changes, remembers completed assessments, and preserves suitable images. Use a section’s Illustrate action to request a new image with optional guidance.</p>
              <p className="mt-2">Composer image model: <code className="font-mono text-xs break-all">{process.env.OPENROUTER_IMAGE_MODEL || "qwen/qwen-image-2.1-turbo"}</code></p>
              <p className="mt-1">Composer vector model: <code className="font-mono text-xs break-all">{process.env.OPENROUTER_VECTOR_MODEL || "recraft/recraft-v4.1-pro-vector"}</code></p>
            </InfoPopover>
          </div>
          <p className="mt-1 text-panel text-muted-foreground">{process.env.OPENROUTER_API_KEY ? "Connected." : "Add OPENROUTER_API_KEY to the server environment to connect."}</p>
        </div>
        <div className="mt-6 border-t pt-6">
          <div className="flex items-center gap-1.5">
            <h3 className="font-medium">ElevenLabs</h3>
            <SettingHint>Voices the narration of Video scenes.</SettingHint>
          </div>
          <p className="mt-1 text-panel text-muted-foreground">{process.env.ELEVENLABS_API_KEY ? "Connected." : "Add ELEVENLABS_API_KEY to the server environment to connect."}</p>
        </div>
        <div className="mt-6 border-t pt-6">
          <div className="mb-5 flex items-center gap-1.5"><h3 className="font-medium">Model by role</h3><InfoPopover label="About model by role">
            <p>Run a role on its own model: a fast one to write, a smart one to decide and review, a cheap one for routine work. Roles left on Active model follow the pick above.</p>
            <p className="mt-2">The Extractor and Organizer guide the Reconciler’s request, so they use its model. Unnamed steps (topic placement, entity clean-up, stakeholder cards, chat) use the active model. Each role is offered only the models that read the data it sends.</p>
          </InfoPopover></div>
          <RoleModels settings={modelSettings} />
        </div>
        <div className="mt-6 border-t pt-6">
          <div className="mb-5 flex items-center gap-1.5"><h3 className="font-medium">Article charter</h3><SettingHint>Steers which subjects get their own article. Leave Purpose empty and new articles are not checked against it.</SettingHint></div>
          <ArticleCharterForm charter={articleCharter} />
        </div>
      </SettingsCard>
    ),
    features: (
      <SettingsCard id="features" title="Features" description="Choose what your wiki does on its own." icon={ToggleRight}>
        <AutoDecide enabled={glossaryAutoDecide} />
        <div className="mt-6 border-t pt-6"><AutoUpdateStale enabled={autoUpdateStale} /></div>
        <div className="mt-6 border-t pt-6"><ExternalKnowledge enabled={externalKnowledge.enabled} ready={externalKnowledge.ready} /></div>
        <div className="mt-6 border-t pt-6"><Monetization enabled={monetization} billing={featureFlags.billing} /></div>
        <div className="mt-6 border-t pt-6"><FeatureFlags flags={featureFlags} /></div>
      </SettingsCard>
    ),
    security: <SettingsCard id="security" title="Security" description="Keep your account protected with a strong password." icon={LockKeyhole}><PasswordForm /></SettingsCard>,
    agents: <SettingsCard id="agents" title="Agents" description="Outside AI agents that can use this wiki, and what each may do." icon={Bot}><AgentKeys /></SettingsCard>,
    gmail: gmail ? <SettingsCard id="gmail" title="Gmail" description="Import email threads from Gmail as sources." icon={Mail}><GmailImport status={gmail.status} missingEnv={gmail.missingEnv} outcome={gmailOutcome} /></SettingsCard> : null,
    usage: <SettingsCard id="usage" title="Usage & activity" description="A closer look at your AI calls and token consumption." icon={ChartNoAxesCombined}><UsagePanel /></SettingsCard>,
    costs: <SettingsCard id="costs" title="AI costs" description="What each model costs per million tokens, and what you've spent." icon={CircleDollarSign}><CostTable activeModel={modelSettings.activeModel} /></SettingsCard>,
    speed: <SettingsCard id="speed" title="AI Speed" description="A live test of how fast each model answers: latency and tokens per second." icon={Gauge}><AiSpeed settings={modelSettings} saved={speedTests} /></SettingsCard>,
  };
  return (
    <ReadingPane title="Settings">
      <div className="mt-2">
        <SettingsTabs tabs={sections.filter(({ id }) => panels[id]).map(({ id, label, icon: Icon }) => ({ id, label, icon: <Icon size={16} aria-hidden="true" />, panel: panels[id] }))} />
      </div>
    </ReadingPane>
  );
}


