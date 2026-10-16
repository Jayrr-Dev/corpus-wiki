"use client";

import { type FormEvent, useState } from "react";
import { ErrorNote, Note } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type ArticleCharter, CHARTER_FIELD_MAX } from "@/lib/living-page/articleCharter";
import { setArticleCharter } from "@/lib/server-actions/settings";
import { SettingHint } from "./SettingHint";

const FIELDS: { key: keyof ArticleCharter; label: string; hint: string; placeholder: string }[] = [
  { key: "purpose", label: "Purpose", hint: "What this wiki is for. The Article Reviewer approves a new article only when it serves this purpose.", placeholder: "Reference for preparing Utility Line Assignment applications in Edmonton." },
  { key: "audience", label: "Audience", hint: "Who reads the articles, so the reviewer can tell what deserves its own page.", placeholder: "Drafting technologists and designers new to the ULA process." },
  { key: "outOfScope", label: "Out of scope", hint: "Subjects that never get their own article. Their knowledge is still kept.", placeholder: "Vendor marketing, general HR policy, job postings." },
];

// ARTICLE CHARTER: the purpose, audience and exclusions that decide which subjects earn an article
export function ArticleCharterForm({ charter }: { charter: ArticleCharter }) {
  const [value, setValue] = useState(charter);
  const [isSaved, setIsSaved] = useState(false);
  const save = useServerAction(setArticleCharter);
  const changed = FIELDS.some(({ key }) => value[key].trim() !== charter[key]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaved(false);
    const result = await save.run(value);
    if (result.ok) setIsSaved(true);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {FIELDS.map(({ key, label, hint, placeholder }) => (
        <div key={key} className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor={`charter-${key}`}>{label}</Label>
            <SettingHint>{hint}</SettingHint>
          </div>
          <Textarea id={`charter-${key}`} maxLength={CHARTER_FIELD_MAX} placeholder={placeholder} value={value[key]}
            onChange={(event) => { setIsSaved(false); setValue({ ...value, [key]: event.target.value }); }} />
        </div>
      ))}
      <div>
        <Button type="submit" size="lg" variant="outline" disabled={save.isPending || !changed}>
          {save.isPending ? "Saving…" : "Save charter"}
        </Button>
      </div>
      <ErrorNote error={save.error} />
      {isSaved ? <Note>Charter saved.</Note> : null}
    </form>
  );
}
