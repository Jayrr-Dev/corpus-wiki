"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { AGENT_SCOPES, DEFAULT_SCOPES, SCOPE_INFO, type AgentScope } from "@/lib/agents/scopes";
import { approveAuthorization, denyAuthorization } from "./actions";

const ALL_SPACES = "all";

type ConsentFormProps = {
  query: string;
  clientName: string;
  clientId: string;
  // The domain that vouches for the client's name (metadata document clients)
  verifiedHost: string | null;
  redirectHost: string;
  loopbackOnly: boolean;
  spaces: { id: string; name: string }[];
  defaultSpaceId: string;
  requestedScopes: AgentScope[];
};

// CONSENT: who is asking, where the answer goes, which Space and what the agent may do
export function ConsentForm(props: ConsentFormProps) {
  const [space, setSpace] = useState(props.requestedScopes.includes("spaces") ? ALL_SPACES : props.defaultSpaceId);
  const [scopes, setScopes] = useState<AgentScope[]>(props.requestedScopes.length ? props.requestedScopes : [...DEFAULT_SCOPES]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const allSpaces = space === ALL_SPACES;
  const shownScopes = allSpaces ? scopes : scopes.filter((scope) => scope !== "spaces");

  const toggle = (scope: AgentScope, on: boolean) =>
    setScopes((current) => (on ? AGENT_SCOPES.filter((item) => item === scope || current.includes(item)) : current.filter((item) => item !== scope)));

  // Runs one answer and follows the redirect it returns
  const answer = (run: () => ReturnType<typeof denyAuthorization>) => {
    setError(null);
    startTransition(async () => {
      const result = await run();
      if (result.ok) window.location.assign(result.redirectTo);
      else setError(result.error);
    });
  };

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-base font-medium break-words">{props.clientName} wants to use your wiki</h2>
        <p className="mt-1 text-panel text-muted-foreground">
          {props.verifiedHost ? <>Identified by <span className="font-medium text-foreground">{props.verifiedHost}</span>. </> : null}
          After you allow it, you go back to <span className="font-medium text-foreground break-all">{props.redirectHost}</span>.
        </p>
        {props.loopbackOnly ? (
          <p className="mt-2 rounded-lg border px-3 py-2 text-panel">
            This app runs on your own computer. Only allow it if you started it just now.
          </p>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="consent-space">Space</Label>
        <NativeSelect id="consent-space" className="w-full" value={space} onChange={(event) => setSpace(event.target.value)}>
          {props.spaces.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}
          <NativeSelectOption value={ALL_SPACES}>All my Spaces</NativeSelectOption>
        </NativeSelect>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">What it may do</legend>
        <div className="grid gap-2">
          {AGENT_SCOPES.map((scope) => {
            const disabled = scope === "spaces" && !allSpaces;
            return (
              <label key={scope} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-panel ${disabled ? "opacity-50" : ""}`}>
                <input type="checkbox" className="mt-1 accent-link" checked={shownScopes.includes(scope)} disabled={disabled} onChange={(event) => toggle(scope, event.target.checked)} />
                <span>
                  <span className="font-medium">{SCOPE_INFO[scope].label}</span>
                  {props.requestedScopes.includes(scope) ? <span className="text-muted-foreground"> (asked for)</span> : null}
                  <span className="block text-muted-foreground">{SCOPE_INFO[scope].description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {error ? <p role="alert" className="text-panel text-destructive">{error}</p> : null}
      <p className="text-panel text-muted-foreground">You can see what it does, and revoke it, in Settings, Agents.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={isPending} onClick={() => answer(() => denyAuthorization(props.query))}>Deny</Button>
        <Button type="button" disabled={isPending || shownScopes.length === 0} onClick={() => answer(() => approveAuthorization(props.query, allSpaces ? null : space, shownScopes))}>
          {isPending ? "Working…" : "Allow"}
        </Button>
      </div>
    </div>
  );
}
