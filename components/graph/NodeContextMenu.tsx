"use client";
import { useState, type CSSProperties } from "react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useDomains, useRelationships } from "@/lib/queries";
import { useUnitSummaries } from "@/lib/queries/screens";
import { UnitActionForm } from "@/components/actions/ActionDialog";
import { useServerAction } from "@/components/actions/useServerAction";
import { moveGraphClaim, setGraphLinkRemoved } from "@/lib/server-actions/graphNodes";
import type { GraphData, GraphNode } from "@/lib/graph";

type Selection={node:GraphNode;x:number;y:number};
export function NodeContextMenu({context,data,onClose,onOpen}:{context:Selection|null;data:GraphData;onClose:()=>void;onOpen:(node:GraphNode)=>void}) {
  const [edit,setEdit]=useState<{node:GraphNode;mode:"move"|"link"|"links"}|null>(null);
  const choose=(mode:"move"|"link"|"links")=>{if(context)setEdit({node:context.node,mode});onClose();};
  return <>
    <DropdownMenu open={!!context} onOpenChange={open=>{if(!open)onClose();}}>
      <DropdownMenuTrigger asChild><button aria-label="Node actions" tabIndex={-1} className="fixed left-[var(--menu-x)] top-[var(--menu-y)] h-px w-px opacity-0 pointer-events-none" style={{"--menu-x":`${context?.x??0}px`,"--menu-y":`${context?.y??0}px`} as CSSProperties} /></DropdownMenuTrigger>
      <DropdownMenuContent onCloseAutoFocus={e=>e.preventDefault()}>
        <DropdownMenuItem onSelect={()=>{if(context)onOpen(context.node);onClose();}}>Open details</DropdownMenuItem>
        {context?.node.kind==="unit" && <>
          <DropdownMenuItem onSelect={()=>choose("move")}>Move to domain…</DropdownMenuItem>
          <DropdownMenuItem onSelect={()=>choose("link")}>Add link…</DropdownMenuItem>
          <DropdownMenuItem onSelect={()=>choose("links")}>Remove or restore links…</DropdownMenuItem>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={!!edit} onOpenChange={open=>{if(!open)setEdit(null);}}><DialogContent className="max-h-[80vh] overflow-y-auto">
      {edit && <NodeEditor key={edit.node.id+edit.mode} {...edit} data={data} onDone={()=>setEdit(null)} />}
    </DialogContent></Dialog>
  </>;
}
function NodeEditor({node,mode,data,onDone}:{node:GraphNode;mode:"move"|"link"|"links";data:GraphData;onDone:()=>void}) {
  const units=useUnitSummaries([node.id]);
  const domains=useDomains();
  const relationships=useRelationships();
  const move=useServerAction(moveGraphClaim);
  const remove=useServerAction(setGraphLinkRemoved);
  const [removeId,setRemoveId]=useState<string|null>(null);
  const [source,setSource]=useState(node.domainPaths[0]??"");
  const [destination,setDestination]=useState("");
  const [search,setSearch]=useState("");
  if(mode==="link") return units.data?.[0] ? <UnitActionForm mode="link" unit={units.data[0]} onDone={onDone}/> : <><DialogTitle>Add link</DialogTitle><p>{units.error?.message??"Loading claim…"}</p></>;
  const links=(relationships.data??[]).filter(l=>l.from_unit_id===node.id||l.to_unit_id===node.id);
  return <div className="space-y-4"><DialogHeader><DialogTitle>{mode==="move"?"Move to domain":"Manage links"}</DialogTitle><DialogDescription>{node.label}</DialogDescription></DialogHeader>
    {mode==="move" ? <>
      <label className="block text-sm">Move from<select aria-label="Move from domain" className="block w-full rounded border bg-background p-2" value={source} onChange={e=>setSource(e.target.value)}>{!node.domainPaths.length&&<option value="">Unfiled</option>}{node.domainPaths.map(p=><option key={p}>{p}</option>)}</select></label>
      <Input aria-label="Find destination domain" placeholder="Find a domain…" value={search} onChange={e=>setSearch(e.target.value)}/>
      <label className="block text-sm">Destination<select aria-label="Destination domain" className="block w-full rounded border bg-background p-2" value={destination} onChange={e=>setDestination(e.target.value)}><option value="">Choose a domain</option>{(domains.data??[]).filter(d=>!d.retired_at&&d.path!==source&&d.path.toLowerCase().includes(search.toLowerCase())).map(d=><option key={d.id} value={d.path}>{d.path}</option>)}</select></label>
      <p className="text-xs text-muted-foreground">Other memberships stay intact. Undo this move in Changes.</p>
      <Button disabled={!destination||move.isPending} onClick={async()=>{const r=await move.run(node.id,source,destination);if(r.ok)onDone();}}>Move</Button>
    </> : <>
      <p className="text-xs text-muted-foreground">Saved links only. Removed links can be restored here. Similarity lines are calculated automatically.</p>
      {relationships.isPending?<p>Loading links…</p>:!links.length?<p>No saved links.</p>:links.map(l=><div key={l.id} className="flex items-center justify-between gap-3 border-b py-2"><span className="text-sm">{l.from_unit_id===node.id?"→":"←"} {l.type.replaceAll("_"," ")}: {data.nodes.find(n=>n.id===(l.from_unit_id===node.id?l.to_unit_id:l.from_unit_id))?.label??"Claim outside this graph"}</span><Button size="sm" variant={l.retired_at?"outline":"destructive"} disabled={remove.isPending} onClick={()=>{if(l.retired_at)void remove.run(node.id,l.id,false);else setRemoveId(l.id);}}>{l.retired_at?"Restore":"Remove"}</Button></div>)}
    </>}
    <Dialog open={!!removeId} onOpenChange={open=>{if(!open&&!remove.isPending)setRemoveId(null);}}><DialogContent><DialogHeader><DialogTitle>Remove this link?</DialogTitle><DialogDescription>The saved connection will be removed. Both claims stay intact, and you can restore the link here.</DialogDescription></DialogHeader><Button variant="ghost" disabled={remove.isPending} onClick={()=>setRemoveId(null)}>Cancel</Button><Button variant="destructive" disabled={remove.isPending} onClick={async()=>{if(!removeId)return;const r=await remove.run(node.id,removeId,true);if(r.ok)setRemoveId(null);}}>Confirm removal</Button><ErrorNote error={remove.error}/></DialogContent></Dialog>
    <ErrorNote error={move.error??remove.error??domains.error?.message??relationships.error?.message}/>
  </div>;
}
