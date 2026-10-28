"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { CheckIcon, ChevronsUpDownIcon, Globe2, LayersIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { PublishingDialog } from "@/components/publishing/PublishingDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { createSpace, deleteSpace, renameSpace, switchSpace } from "@/lib/server-actions/spaces";
import { SPACE_CHANGED_KEY, type Space } from "@/lib/spaces/shared";
import { describeCallError } from "@/lib/server-actions/result";

const OPEN_PUBLISHING_KEY = "corpus-wiki-open-publishing";

export function SpaceSwitcher({ spaces, activeSpace }: { spaces: Space[]; activeSpace: Space }) {
  const [dialog, setDialog] = useState<"create" | "rename" | "delete" | null>(null);
  const [publishingOpen, setPublishingOpen] = useState(false);
  const [managedSpace, setManagedSpace] = useState<Space | null>(null);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const deleting = dialog === "delete";
  const dialogTitle = deleting ? "Delete Space" : dialog === "rename" ? "Rename Space" : "Create Space";
  const targetSpace = managedSpace ?? activeSpace;

  // The selected space is shared by the session cookie. Reload other tabs too,
  // so a tab cannot display one space while its next action writes to another.
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === SPACE_CHANGED_KEY) window.location.assign(new URL("/", window.location.origin).href);
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const pendingId = sessionStorage.getItem(OPEN_PUBLISHING_KEY);
        if (!pendingId) return;
        sessionStorage.removeItem(OPEN_PUBLISHING_KEY);
        if (pendingId === activeSpace.id) setPublishingOpen(true);
      } catch { /* storage may be disabled */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeSpace.id]);

  function enterSpace() {
    try { localStorage.setItem(SPACE_CHANGED_KEY, crypto.randomUUID()); } catch { /* storage may be disabled */ }
    // A full navigation discards all query caches, subscriptions and page state.
    window.location.assign(new URL("/", window.location.origin).href);
  }

  function openPublishing(space: Space) {
    setError(null);
    if (space.id === activeSpace.id) {
      setPublishingOpen(true);
      return;
    }
    try { sessionStorage.setItem(OPEN_PUBLISHING_KEY, space.id); } catch { /* storage may be disabled */ }
    startTransition(async () => {
      try {
        const result = await switchSpace(space.id);
        if (result.ok) enterSpace();
        else {
          try { sessionStorage.removeItem(OPEN_PUBLISHING_KEY); } catch { /* storage may be disabled */ }
          setError(result.error);
        }
      } catch (caught) {
        try { sessionStorage.removeItem(OPEN_PUBLISHING_KEY); } catch { /* storage may be disabled */ }
        setError(describeCallError(caught));
      }
    });
  }

  function choose(id: string) {
    if (id === activeSpace.id) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await switchSpace(id);
        if (result.ok) enterSpace();
        else setError(result.error);
      } catch (caught) { setError(describeCallError(caught)); }
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = dialog === "delete"
          ? await deleteSpace(targetSpace.id, name)
          : dialog === "rename"
            ? await renameSpace(targetSpace.id, name)
            : await createSpace(name);
        if (result.ok) enterSpace();
        else setError(result.error);
      } catch (caught) { setError(describeCallError(caught)); }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton tooltip={activeSpace.name} disabled={pending} aria-label={`Current space: ${activeSpace.name}. Manage spaces`}>
            <LayersIcon />
            <span className="truncate font-medium">{activeSpace.name}</span>
            <ChevronsUpDownIcon className="ml-auto size-3.5" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-56 max-w-80" align="start">
          <p className="px-1.5 py-1 text-xs text-muted-foreground">Your spaces</p>
          {spaces.map((space) => (
            <DropdownMenuSub key={space.id} open={actionsFor === space.id} onOpenChange={(open) => setActionsFor((current) => open ? space.id : current === space.id ? null : current)}>
              <div className="group/space relative flex items-center rounded-md hover:bg-accent focus-within:bg-accent">
                <DropdownMenuItem className="min-w-0 flex-1" disabled={pending} onSelect={() => choose(space.id)}>
                  <LayersIcon className="size-4 shrink-0" />
                  <span className="truncate">{space.name}</span>
                </DropdownMenuItem>
                <div className="relative flex size-7 shrink-0 items-center justify-center">
                  {space.id === activeSpace.id ? <CheckIcon className={`pointer-events-none absolute size-4 group-hover/space:opacity-0 group-focus-within/space:opacity-0 [@media(hover:none)]:opacity-0 ${actionsFor === space.id ? "opacity-0" : ""}`} /> : null}
                <DropdownMenuSubTrigger asChild disabled={pending}>
                  <button type="button" aria-label={`Actions for ${space.name}`} className="flex size-7 items-center justify-center rounded-md opacity-0 outline-none hover:bg-muted focus:bg-muted group-hover/space:opacity-100 group-focus-within/space:opacity-100 data-[state=open]:bg-muted data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100">
                    <MoreHorizontalIcon className="size-4" />
                  </button>
                </DropdownMenuSubTrigger>
                </div>
              </div>
              <DropdownMenuSubContent sideOffset={6}>
                <DropdownMenuItem disabled={pending} onSelect={() => openPublishing(space)}>
                  <Globe2 className="size-4" /> Publishing
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={pending} onSelect={() => { setManagedSpace(space); setName(space.name); setError(null); setDialog("rename"); }}>
                  <PencilIcon className="size-4" /> Rename Space
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" disabled={pending} onSelect={() => { setManagedSpace(space); setName(""); setError(null); setDialog("delete"); }}>
                  <Trash2Icon className="size-4" /> Delete Space
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={pending} onSelect={() => { setName(""); setError(null); setDialog("create"); }}>
            <PlusIcon className="size-4" /> Create Space
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && !dialog ? <p role="alert" className="px-2 text-xs text-destructive">{error}</p> : null}
      <Dialog open={dialog !== null} onOpenChange={(value) => { if (!pending && !value) setDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              {deleting
                ? <>This removes “{targetSpace.name}” and all its wikis, sources, assets, and AI memory from your account. Your other spaces stay unchanged.</>
                : dialog === "rename"
                  ? <>Give “{targetSpace.name}” a new name. Its content stays the same.</>
                  : <>A fresh place to explore a topic. Wikis, sources, and AI memory stay separate from your other spaces. Only you can access it.</>}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="space-name">{deleting ? <>Type <span className="break-all font-semibold">{targetSpace.name}</span> to confirm</> : "Space name"}</Label>
              <Input id="space-name" placeholder={deleting ? targetSpace.name : "e.g. History, Gardening, My next project"} value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required autoFocus autoComplete="off" spellCheck={!deleting} disabled={pending} />
            </div>
            {deleting && spaces.length < 2 ? <p className="text-panel text-muted-foreground">Keep at least one space. Create another space before deleting this one.</p> : null}
            {error ? <p role="alert" className="text-panel text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={pending}>Cancel</Button>
              <Button type="submit" variant={deleting ? "destructive" : "default"} disabled={pending || !name.trim() || (deleting && (name !== targetSpace.name || spaces.length < 2)) || (dialog === "rename" && name.trim() === targetSpace.name)}>
                {pending ? deleting ? "Deleting…" : dialog === "rename" ? "Saving…" : "Creating…" : deleting ? "Delete Space" : dialog === "rename" ? "Save name" : "Create Space"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <PublishingDialog open={publishingOpen} onOpenChange={setPublishingOpen} />
    </>
  );
}
