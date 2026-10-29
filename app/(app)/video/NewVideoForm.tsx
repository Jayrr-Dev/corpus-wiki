"use client";

import { useQuery } from "@tanstack/react-query";
import { Play, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { DialogForm } from "@/components/actions/DialogForm";
import { NewButton } from "@/components/actions/NewButton";
import { useServerAction } from "@/components/actions/useServerAction";
import { CoveragePicker } from "@/components/knowledge/CoveragePicker";
import { ScopePicker } from "@/components/knowledge/ScopePicker";
import { InfoHint } from "@/components/standard/info-hint";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { Coverage, Scope, ScopeOptions } from "@/lib/knowledge/scopeTypes";
import { LENGTH_PLAN, VIDEO_LENGTHS, type VideoLength, type VoiceOption } from "@/lib/video/types";
import { createVideo } from "./actions";

// A field's label, with an optional hint beside it
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-sm font-medium">{label}{hint ? <InfoHint>{hint}</InfoHint> : null}</div>
      {children}
    </div>
  );
}

// NEW VIDEO button and its form
export function NewVideoButton({ options }: { options: ScopeOptions }) {
  return <NewButton label="New video">{(close) => <NewVideoForm options={options} onDone={close} />}</NewButton>;
}

// NEW VIDEO: source, coverage, length and voice; Write script asks the Narrator for scenes (nothing is voiced yet)
export function NewVideoForm({ options, onDone }: { options: ScopeOptions; onDone: () => void }) {
  const router = useRouter();
  const lengthName = useId();
  const [scope, setScope] = useState<Scope | null>(null);
  const [coverage, setCoverage] = useState<Coverage>(100);
  const [length, setLength] = useState<VideoLength>("short");
  const [voiceId, setVoiceId] = useState("");
  const create = useServerAction(createVideo, { progress: { title: "Writing the script…" }, refreshTables: [] });
  const voices = useQuery({
    queryKey: ["video-voices"],
    queryFn: async (): Promise<VoiceOption[]> => {
      const response = await fetch("/api/video/voices");
      if (!response.ok) throw new Error("Could not load voices.");
      return ((await response.json()) as { voices: VoiceOption[] }).voices;
    },
    staleTime: 5 * 60_000,
  });
  const voice = voiceId || voices.data?.[0]?.id || "";

  const submit = async () => {
    const result = await create.run({ scope, coverage, length, voiceId: voice });
    if (!result.ok) return;
    onDone();
    router.push(`/video/${result.id}`);
  };

  return (
    <DialogForm title="New video" description="The Narrator writes the scenes. Nothing is voiced until you continue." submitLabel="Write script" isPending={create.isPending} error={create.error} isDisabled={!scope || !voice} onSubmit={submit}>
      <Field label="Source"><ScopePicker options={options} value={scope} onChange={setScope} disabled={create.isPending} /></Field>
      <Field label="Coverage"><CoveragePicker value={coverage} onChange={setCoverage} disabled={create.isPending} /></Field>
      <Field label="Length" hint="Longer videos cover more claims, not slower narration.">
        <div role="radiogroup" aria-label="Length" className="flex flex-wrap gap-x-5 gap-y-2">
          {VIDEO_LENGTHS.map((item) => (
            <label key={item} className="flex items-center gap-2 text-panel">
              <input type="radio" name={lengthName} className="accent-link" checked={length === item} disabled={create.isPending} onChange={() => setLength(item)} />
              <span className="font-medium">{LENGTH_PLAN[item].label}</span>
            </label>
          ))}
        </div>
      </Field>
      <Field label="Voice">
        <div className="flex items-center gap-2">
          <NativeSelect aria-label="Voice" className="w-full" value={voice} disabled={create.isPending || !voices.data?.length} onChange={(event) => setVoiceId(event.target.value)}>
            {voices.data?.length ? null : <NativeSelectOption value="">{voices.isPending ? "Loading voices…" : "No voices."}</NativeSelectOption>}
            {voices.data?.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}
          </NativeSelect>
          <VoicePreview key={voice} url={voices.data?.find((item) => item.id === voice)?.previewUrl ?? null} />
        </div>
      </Field>
    </DialogForm>
  );
}

// ▶ PREVIEW: plays the voice's sample clip from ElevenLabs
function VoicePreview({ url }: { url: string | null }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = () => {
    if (!url) return;
    if (playing) { audio.current?.pause(); setPlaying(false); return; }
    audio.current ??= new Audio();
    audio.current.src = url;
    audio.current.onended = () => setPlaying(false);
    void audio.current.play().then(() => setPlaying(true), () => setPlaying(false));
  };
  return (
    <Tooltip content={playing ? "Stop" : "Preview"}>
      <Button type="button" variant="outline" size="icon" aria-label={playing ? "Stop preview" : "Preview voice"} disabled={!url} onClick={toggle}>
        {playing ? <Square /> : <Play />}
      </Button>
    </Tooltip>
  );
}
