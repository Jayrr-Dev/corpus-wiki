"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useDomains } from "@/lib/queries";
import { useServerAction } from "@/components/actions/useServerAction";
import { organizeGraphSelection } from "@/lib/server-actions/graphNodes";

import type { GraphNode } from "@/lib/graph";

export function SelectionActions({nodes,onClear}:{nodes:GraphNode[];onClear:()=>void}) {
  const [mode,setMode]=useState<"move"|"create"|null>(null);
  const [ids,setIds]=useState<string[]>([]);
  const [destination,setDestination]=useState("");
  const [name,setName]=useState("");

  const [message,setMessage]=useState("");
  const domains=useDomains();
  const action=useServerAction(organizeGraphSelection);

  const start=(next:"move"|"create")=>{setIds(nodes.map(n=>n.id));setMode(next);setDestination("");setName("");action.reset();};
  return <>
    {(nodes.length>0) && <div className="absolute top-3 left-3 z-20 flex max-w-[75%] flex-wrap items-center gap-2 rounded-lg border bg-background p-2 shadow-md" aria-label="Selected node actions">
      {nodes.length>0 && <><span className="text-sm">{nodes.length} selected</span><Button size="sm" variant="outline" onClick={()=>start("move")}>Move selected</Button><Button size="sm" variant="outline" onClick={()=>start("create")}>Create domain</Button><Button size="sm" variant="ghost" onClick={onClear}>Clear selection</Button></>}
      {message&&<p role="status" className="text-xs">{message}</p>}
    </div>}
    <Dialog open={mode!==null} onOpenChange={open=>{if(!open&&!action.isPending)setMode(null);}}><DialogContent><DialogHeader><DialogTitle>{mode==="create"?"Create domain from selection":"Move selected nodes"}</DialogTitle><DialogDescription>{ids.length} claims will be filed only in the destination domain. Their current domain memberships will be replaced. Claim text and links stay intact.</DialogDescription></DialogHeader>
      <label className="text-sm">{mode==="create"?"Parent domain":"Destination domain"}<select aria-label="Selection destination domain" className="mt-1 block w-full rounded border bg-background p-2" value={destination} disabled={action.isPending} onChange={e=>setDestination(e.target.value)}><option value="">Choose a domain</option>{(domains.data??[]).filter(d=>!d.retired_at).map(d=><option key={d.id} value={d.path}>{d.path}</option>)}</select></label>
      {mode==="create"&&<Input aria-label="New domain name" placeholder="New domain name" value={name} disabled={action.isPending} onChange={e=>setName(e.target.value)}/>}
      <ErrorNote error={action.error??domains.error?.message}/>
      <Button disabled={action.isPending||!destination||(mode==="create"&&!name.trim())} onClick={async()=>{const r=await action.run(ids,destination,mode==="create"?name:"");if(r.ok){setMessage(r.status==="applied"?`${ids.length} claims organized.`:`${r.applied} of ${r.total} actions applied. Review Changes or undo.`);setMode(null);onClear();}}}>{action.isPending?"Saving…":mode==="create"?"Create and move selected":"Move selected"}</Button>
    </DialogContent></Dialog>
  </>;
}
