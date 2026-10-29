"use client";

import { useState } from "react";
import { DialogForm } from "@/components/actions/DialogForm";
import { SignOutIcon } from "@/components/icons";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { signOut } from "@/lib/auth/actions";
import { ThemeSwitch } from "./ThemeSwitch";

// SIGN OUT ROW: asks first in a dialog; the theme switch sits at its far right
export function SignOutRow() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <SidebarMenuItem className="flex items-center gap-1 pr-1">
      <SidebarMenuButton tooltip="Sign out" onClick={() => setOpen(true)} className="min-w-0 flex-1">
        <SignOutIcon />
        <span>Sign out</span>
      </SidebarMenuButton>
      <ThemeSwitch />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogForm
            title="Sign out?"
            description="You will need to sign in again to use the wiki."
            submitLabel="Sign out"
            isPending={pending}
            error={error}
            onSubmit={async () => {
              setPending(true);
              setError(null);
              try {
                await signOut();
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not sign out.");
                setPending(false);
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </SidebarMenuItem>
  );
}
