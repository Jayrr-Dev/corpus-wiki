"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chooseModel } from "@/lib/server-actions/settings";
import type { ModelSettings } from "./loadModelSettings";
import { AiEffort } from "./AiEffort";
import { ModelList } from "./ModelList";

// =====================================================================
// MODEL PICKER: search Token Factory's live list, pick one, save it.
// The pick applies to the next upload, line edit or page build. The default
// effort sits on the right of the buttons.
// =====================================================================

export function ModelPicker({ settings }: { settings: ModelSettings }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(settings.activeModel);
  const save = useServerAction(chooseModel);
  const matches = settings.models.filter((model) => model.toLowerCase().includes(query.trim().toLowerCase()));
  const isUnchanged = selected === settings.activeModel;

  // Saves the pick (null = back to the default), then reloads the page's data
  const apply = async (model: string | null) => {
    const result = await save.run(model);
    if (result.ok) router.refresh();
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="rounded-lg bg-sidebar px-3 py-2.5 text-panel text-muted-foreground">
        Active model: <span className="break-all font-mono text-foreground">{settings.activeModel}</span>
        {settings.chosenModel ? null : <span className="text-faint"> (default)</span>}
      </p>
      <ErrorNote error={settings.listError} />
      <Input className="h-10" placeholder={`Search ${settings.models.length} models…`} value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search models" />
      <ModelList models={matches} selected={selected} activeModel={settings.activeModel} onSelect={setSelected} />
      <ErrorNote error={save.error} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={save.isPending || isUnchanged} onClick={() => apply(selected)}>
            {save.isPending ? "Saving…" : "Use this model"}
          </Button>
          {settings.chosenModel ? (
            <Button type="button" size="sm" variant="ghost" disabled={save.isPending} onClick={() => apply(null)}>
              Back to default
            </Button>
          ) : null}
        </div>
        <AiEffort effort={settings.effort} model={selected} />
      </div>
    </div>
  );
}


