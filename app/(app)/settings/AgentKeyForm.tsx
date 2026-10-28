"use client";

import { type FormEvent, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { FormRow } from "@/components/actions/FormRow";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { AGENT_SCOPES, DEFAULT_SCOPES, SCOPE_INFO, type AgentScope } from "@/lib/agents/scopes";
import { createAgentKey } from "@/lib/server-actions/agentKeys";

const ALL_SPACES = "all";

// NEW AGENT KEY: name, Space (one of mine or all), scopes and an optional expiry.
// Read is on by default; Spaces is only offered for a key for all Spaces.
export function AgentKeyForm({ spaces, onCreated }: { spaces: { id: string; name: string }[]; onCreated: (key: string) => void }) {
  const [name, setName] = useState("");
  const [space, setSpace] = useState(spaces[0]?.id ?? ALL_SPACES);
  const [scopes, setScopes] = useState<AgentScope[]>([...DEFAULT_SCOPES]);
  const [expires, setExpires] = useState("");
  const create = useServerAction(createAgentKey, { progress: false, refreshTables: [] });
  const allSpaces = space === ALL_SPACES;

  // A key tied to one Space cannot hold the Spaces scope
  const chooseSpace = (value: string) => {
    setSpace(value);
    if (value !== ALL_SPACES) setScopes((current) => current.filter((scope) => scope !== "spaces"));
  };
  const toggle = (scope: AgentScope, on: boolean) =>
    setScopes((current) => (on ? AGENT_SCOPES.filter((item) => item === scope || current.includes(item)) : current.filter((item) => item !== scope)));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // The expiry date ends at the close of that day, in the person's time zone
    const expiresAt = expires ? new Date(`${expires}T23:59:59`).toISOString() : null;
    const result = await create.run({ name, spaceId: allSpaces ? null : space, scopes, expiresAt });
    if (!result.ok) return;
    setName("");
    setExpires("");
    setScopes([...DEFAULT_SCOPES]);
    onCreated(result.key);
  };

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <FormRow htmlFor="agent-key-name" label="Name">
        <Input className="h-10" id="agent-key-name" placeholder="Claude Code on my laptop" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
      </FormRow>
      <FormRow htmlFor="agent-key-space" label="Space">
        <NativeSelect id="agent-key-space" className="w-full" value={space} onChange={(event) => chooseSpace(event.target.value)}>
          {spaces.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}
          <NativeSelectOption value={ALL_SPACES}>All my Spaces</NativeSelectOption>
        </NativeSelect>
      </FormRow>
      <fieldset className="sm:col-span-2">
        <legend className="mb-2 text-sm font-medium">What the agent may do</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {AGENT_SCOPES.map((scope) => {
            const disabled = scope === "spaces" && !allSpaces;
            return (
              <label key={scope} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-panel ${disabled ? "opacity-50" : ""}`}>
                <input type="checkbox" className="mt-1 accent-link" checked={scopes.includes(scope)} disabled={disabled} onChange={(event) => toggle(scope, event.target.checked)} />
                <span>
                  <span className="font-medium">{SCOPE_INFO[scope].label}</span>
                  <span className="block text-muted-foreground">{SCOPE_INFO[scope].description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <FormRow htmlFor="agent-key-expires" label="Expires (optional)">
        <Input className="h-10" id="agent-key-expires" type="date" value={expires} onChange={(event) => setExpires(event.target.value)} />
      </FormRow>
      <ErrorNote error={create.error} />
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={create.isPending || !name.trim() || scopes.length === 0}>
          {create.isPending ? "Creating…" : "Create key"}
        </Button>
      </div>
    </form>
  );
}
