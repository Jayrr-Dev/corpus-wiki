"use client";

import { type FormEvent, useState } from "react";
import { ErrorNote, Note } from "@/app/(app)/_components/bits";
import { FormRow } from "@/components/actions/FormRow";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changePassword } from "@/lib/server-actions/settings";

// PASSWORD FORM: new password twice; clears and confirms once it is changed
export function PasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isChanged, setIsChanged] = useState(false);
  const change = useServerAction(changePassword);

  // Sends both fields; the server checks they match
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsChanged(false);
    const result = await change.run(password, confirmation);
    if (!result.ok) return;
    setPassword("");
    setConfirmation("");
    setIsChanged(true);
  };

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <FormRow htmlFor="new-password" label="New password">
        <Input className="h-10" placeholder="Enter a new password" id="new-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </FormRow>
      <FormRow htmlFor="confirm-password" label="Confirm password">
        <Input className="h-10" placeholder="Repeat your new password" id="confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
      </FormRow>
      <ErrorNote error={change.error} />
      {isChanged ? <Note>Password changed.</Note> : null}
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={change.isPending || !password || !confirmation}>
          {change.isPending ? "Changing…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}


