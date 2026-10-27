"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/standard/tooltip";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { graphHistory, stepGraphHistory } from "@/lib/server-actions/graphHistory";

type RedoStack = { ids: string[]; fingerprint: string };
const storageKey = "graph-redo-history";
function readRedo(): RedoStack | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    return value && Array.isArray(value.ids) && value.ids.every((id: unknown) => typeof id === "string") && typeof value.fingerprint === "string" ? value : null;
  } catch { return null; }
}

// The latest undoable graph edit and the graph's fingerprint (GraphScreen starts it with the graph read)
export function useGraphHistory() {
  return useQuery({ queryKey: ["table", "change_sets", "graph-history"], queryFn: async () => {
    const result = await graphHistory();
    if (!result.ok) throw new Error(result.error);
    return result;
  } });
}

export function GraphHistoryControls() {
  const history = useGraphHistory();
  const [redo, setRedo] = useState<RedoStack | null>(readRedo);
  const inFlight = useRef(false);
  const action = useServerAction(stepGraphHistory, { progress: false });
  const undo = history.data?.undo;
  const validRedo = redo?.fingerprint === history.data?.fingerprint ? redo : null;
  async function step(direction: "undo" | "redo") {
    const id = direction === "undo" ? undo?.id : validRedo?.ids.at(-1);
    if (!id || !history.data || inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await action.run(id, direction, history.data.fingerprint);
      if (result.ok) {
        const next = { ids: direction === "undo" ? [...(validRedo?.ids ?? []), id] : (validRedo?.ids ?? []).slice(0, -1), fingerprint: result.fingerprint };
        setRedo(next);
        try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* History still works without storage. */ }
      }
    } finally { inFlight.current = false; }
  }
  return <div className="flex flex-col gap-1">
    <div className="grid grid-cols-2 gap-2">
      <Tooltip content={undo?.summary ?? "No edits to undo"}><span className="min-w-0"><Button className="w-full" size="sm" variant="outline" disabled={!undo || action.isPending} onClick={() => step("undo")}><Undo2 size={14}/>Undo</Button></span></Tooltip>
      <Tooltip content="Redo the last undone edit"><span className="min-w-0"><Button className="w-full" size="sm" variant="outline" disabled={!validRedo?.ids.length || action.isPending} onClick={() => step("redo")}><Redo2 size={14}/>Redo</Button></span></Tooltip>
    </div>
    <ErrorNote error={action.error ?? history.error?.message}/>
  </div>;
}
