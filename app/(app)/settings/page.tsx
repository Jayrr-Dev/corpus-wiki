import Link from "next/link";
import { ArrowUpRight, BrainCircuit, ChartNoAxesCombined, LockKeyhole, SlidersHorizontal, Sparkles, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ReadingPane } from "@/components/shell";
import { UsagePanel } from "@/components/usage/UsagePanel";
import { AutoUpdateStale } from "./AutoUpdateStale";
import { loadAutoUpdateStale, loadModelSettings } from "./loadModelSettings";
import { ModelPicker } from "./ModelPicker";
import { PasswordForm } from "./PasswordForm";

export const dynamic = "force-dynamic";

const sections = [
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "intelligence", label: "Intelligence", icon: BrainCircuit },
  { id: "security", label: "Security", icon: LockKeyhole },
  { id: "usage", label: "Usage & activity", icon: ChartNoAxesCombined },
];

function SettingsCard({ id, title, description, icon: Icon, children }: {
  id: string; title: string; description: string; icon: LucideIcon; children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="min-w-0 scroll-mt-6 rounded-2xl border bg-background shadow-sm">
      <header className="flex items-start gap-3 border-b px-5 py-5 sm:px-6">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border bg-sidebar text-muted-foreground"><Icon size={17} aria-hidden="true" /></span>
        <div><h2 id={`${id}-title`} className="text-sm font-semibold">{title}</h2><p className="mt-1 text-panel text-muted-foreground">{description}</p></div>
      </header>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const [modelSettings, autoUpdateStale] = await Promise.all([loadModelSettings(), loadAutoUpdateStale()]);
  return (
    <ReadingPane title="Settings">
      <p className="-mt-2 text-panel text-muted-foreground">Make this workspace work the way you think.</p>
      <div className="mt-4 grid items-start gap-6">
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto pb-1">
          {sections.map(({ id, label, icon: Icon }) => (
            <a key={id} href={`#${id}`} className="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-panel text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"><Icon size={16} aria-hidden="true" />{label}</a>
          ))}
          <p className="mt-6 hidden border-t px-3 pt-4 text-xs leading-relaxed text-faint lg:block">Your preferences apply across this workspace.</p>
        </nav>
        <div className="flex min-w-0 flex-col gap-6">
          <SettingsCard id="preferences" title="Workspace preferences" description="Keep your knowledge fresh, on your terms." icon={SlidersHorizontal}>
            <AutoUpdateStale enabled={autoUpdateStale} />
          </SettingsCard>
          <SettingsCard id="intelligence" title="Intelligence" description="Fine-tune the AI behind your second brain." icon={BrainCircuit}>
            <div className="mb-5"><h3 className="font-medium">AI model</h3><p className="mt-1 text-panel text-muted-foreground">Used for uploads, line edits, and page builds.</p></div>
            <ModelPicker settings={modelSettings} />
            <Link href="/skills" className="mt-6 flex items-center gap-3 rounded-xl border bg-sidebar/50 p-4 transition-colors hover:bg-hover">
              <Sparkles size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1"><span className="font-medium">AI skills</span><p className="mt-1 text-panel text-muted-foreground">Customize the instructions for each AI stage.</p></div>
              <ArrowUpRight size={17} className="shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </SettingsCard>
          <SettingsCard id="security" title="Security" description="Keep your account protected with a strong password." icon={LockKeyhole}><PasswordForm /></SettingsCard>
          <SettingsCard id="usage" title="Usage & activity" description="A closer look at your AI calls and token consumption." icon={ChartNoAxesCombined}><UsagePanel /></SettingsCard>
        </div>
      </div>
    </ReadingPane>
  );
}


