"use client";
import {useState,type CSSProperties} from "react";
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from "@/components/ui/dropdown-menu";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {ErrorNote} from "@/app/(app)/_components/bits";
import {useDomains} from "@/lib/queries";
import {useServerAction} from "@/components/actions/useServerAction";
import {editGraphDomain} from "@/lib/server-actions/graphDomains";

type Mode="rename"|"move"|"remove";
export function DomainContextMenu({context,onClose,onChanged}:{context:{path:string;x:number;y:number}|null;onClose:()=>void;onChanged:()=>void}){
 const domains=useDomains();const action=useServerAction(editGraphDomain);
 const [edit,setEdit]=useState<{path:string;mode:Mode}|null>(null);const [value,setValue]=useState("");
 const source=domains.data?.find(d=>d.path===(context?.path??edit?.path));
 const parent=domains.data?.find(d=>d.id===source?.parent_id);
 const grandparent=domains.data?.find(d=>d.id===parent?.parent_id);
 const start=(mode:Mode,initial="")=>{if(context){setEdit({path:context.path,mode});setValue(mode==='rename'?context.path.split('/').at(-1)!:initial);action.reset();}onClose();};
 return <>
 <DropdownMenu open={!!context} onOpenChange={open=>{if(!open)onClose();}}><DropdownMenuTrigger asChild><button tabIndex={-1} aria-label="Domain actions" className="pointer-events-none fixed left-[var(--x)] top-[var(--y)] h-px w-px opacity-0" style={{"--x":`${context?.x??0}px`,"--y":`${context?.y??0}px`} as CSSProperties}/></DropdownMenuTrigger><DropdownMenuContent onCloseAutoFocus={e=>e.preventDefault()}>
 <p className="max-w-72 break-words px-2 py-1 text-xs text-muted-foreground">{context?.path}</p>
 <DropdownMenuItem onSelect={()=>start("rename")}>Rename domain…</DropdownMenuItem>
 <DropdownMenuItem disabled={!grandparent} onSelect={()=>start("move",grandparent!.path)}>Move up one level…</DropdownMenuItem>
 <DropdownMenuItem disabled={!parent} onSelect={()=>start("move")}>Move under another domain…</DropdownMenuItem>
 <DropdownMenuItem variant="destructive" disabled={!parent} onSelect={()=>start("remove")}>Remove domain…</DropdownMenuItem>
 </DropdownMenuContent></DropdownMenu>
 <Dialog open={!!edit} onOpenChange={open=>{if(!open&&!action.isPending)setEdit(null);}}><DialogContent><DialogHeader><DialogTitle>{edit?.mode==='rename'?'Rename domain':edit?.mode==='move'?'Move domain':'Remove this domain?'}</DialogTitle><DialogDescription className="break-words">{edit?.path.split("/").at(-1)}</DialogDescription></DialogHeader>
 {edit?.mode==='rename'?<Input aria-label="Domain name" value={value} onChange={e=>setValue(e.target.value)} disabled={action.isPending}/>:edit?.mode==='move'?<label className="text-sm">New parent<select aria-label="New parent domain" className="mt-1 block w-full rounded border bg-background p-2" value={value} onChange={e=>setValue(e.target.value)} disabled={action.isPending}><option value="">Choose a parent domain</option>{(domains.data??[]).filter(d=>!d.retired_at&&d.id!==source?.parent_id&&d.path!==edit.path&&!d.path.startsWith(edit.path+'/')&&d.path.split('/')[0]===edit.path.split('/')[0]&&d.context_entity_id===source?.context_entity_id).map(d=><option value={d.path} key={d.id}>{d.path}</option>)}</select></label>:<p className="text-sm text-muted-foreground">Contents move to <span className="font-medium text-foreground">{parent?.name}</span>. You can undo this.</p>}
 <ErrorNote error={action.error??domains.error?.message}/>
 <DialogFooter className="flex-row justify-end"><Button variant="outline" disabled={action.isPending} onClick={()=>setEdit(null)}>Cancel</Button>
 <Button variant={edit?.mode==='remove'?'destructive':'default'} disabled={action.isPending||!edit||(edit.mode!=='remove'&&!value.trim())} onClick={async()=>{if(!edit)return;const r=await action.run(edit.path,edit.mode,value);if(r.ok){setEdit(null);onChanged();}}}>{action.isPending?'Saving…':edit?.mode==='remove'?'Remove domain':'Save'}</Button></DialogFooter>
 </DialogContent></Dialog>
 </>;
}

