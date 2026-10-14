"use client";

import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

// NEW BUTTON: the "New …" button above a table; its dialog body gets a close callback
export function NewButton({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">{isOpen ? children(() => setIsOpen(false)) : null}</DialogContent>
    </Dialog>
  );
}
