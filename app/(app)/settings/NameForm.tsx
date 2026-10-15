"use client";

import { type FormEvent, useState } from "react";
import { ErrorNote, Note } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setMyName } from "@/lib/server-actions/settings";
import { SettingHint } from "./SettingHint";

// YOUR NAME: how your changes are signed across the app; empty shows your email
export function NameForm({ name, email }: { name: string | null; email: string | null }) {
  const [value, setValue] = useState(name ?? "");
  const [isSaved, setIsSaved] = useState(false);
  const save = useServerAction(setMyName);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaved(false);
    const result = await save.run(value);
    if (result.ok) setIsSaved(true);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Label htmlFor="display-name">Your name</Label>
        <SettingHint>Shown as who made each change. Leave empty to show your email.</SettingHint>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-9 w-72 max-w-full" placeholder={email ?? "Your name"} id="display-name" autoComplete="name" value={value} onChange={(event) => setValue(event.target.value)} />
        <Button type="submit" size="lg" variant="outline" disabled={save.isPending || value.trim() === (name ?? "")}>
          {save.isPending ? "Saving…" : "Save name"}
        </Button>
      </div>
      <ErrorNote error={save.error} />
      {isSaved ? <Note>Name saved.</Note> : null}
    </form>
  );
}
