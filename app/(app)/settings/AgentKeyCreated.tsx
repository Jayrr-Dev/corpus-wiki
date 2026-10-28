"use client";

import { Check, Copy } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";

// The app's own address, read in the browser (the server has no single public origin)
const noSubscribe = () => () => {};
const readOrigin = () => window.location.origin;
const readNoOrigin = () => "https://your-corpus-wiki";

// Ready-to-paste setup for Claude Code and Claude Desktop
function claudeCodeCommand(origin: string, key: string): string {
  return `claude mcp add --transport http corpus-wiki ${origin}/api/mcp --header "Authorization: Bearer ${key}"`;
}
function claudeDesktopConfig(origin: string, key: string): string {
  // Claude Desktop reaches remote servers through mcp-remote; the header lives in
  // env so the space inside it survives Windows argument parsing
  const config = {
    mcpServers: {
      "corpus-wiki": {
        command: "npx",
        args: ["mcp-remote", `${origin}/api/mcp`, "--header", "Authorization:${AUTH_HEADER}"],
        env: { AUTH_HEADER: `Bearer ${key}` },
      },
    },
  };
  return JSON.stringify(config, null, 2);
}

// One block of text with a copy button
function CopyBlock({ label, text, hint }: { label: string; text: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
    }
  };
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Tooltip content={hint}>
          <Button type="button" variant="outline" size="xs" onClick={copy} aria-label={`Copy ${label}`}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </Tooltip>
      </div>
      <pre className="overflow-x-auto rounded-lg border bg-sidebar px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">{text}</pre>
      {failed ? <p className="text-panel text-muted-foreground">Could not reach the clipboard. Select the text and copy it by hand.</p> : null}
    </div>
  );
}

// THE NEW KEY, shown once: the database keeps only its hash, so it cannot be shown again
export function AgentKeyCreated({ agentKey, onDone }: { agentKey: string; onDone: () => void }) {
  const origin = useSyncExternalStore(noSubscribe, readOrigin, readNoOrigin);
  return (
    <div className="grid gap-4 rounded-xl border border-link/30 bg-link/5 p-4">
      <div>
        <h3 className="font-medium">Your new key</h3>
        <p className="mt-1 text-panel text-muted-foreground">Copy it now. It is shown only once.</p>
      </div>
      <CopyBlock label="Key" text={agentKey} hint="Copy the key" />
      <CopyBlock label="Claude Code" text={claudeCodeCommand(origin, agentKey)} hint="Copy the command; run it in a terminal" />
      <CopyBlock label="Claude Desktop" text={claudeDesktopConfig(origin, agentKey)} hint="Copy into claude_desktop_config.json" />
      <div><Button type="button" size="sm" variant="outline" onClick={onDone}>I have copied it</Button></div>
    </div>
  );
}
