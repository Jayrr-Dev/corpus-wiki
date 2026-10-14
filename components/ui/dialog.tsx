"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// PRIMITIVES RE-EXPORTED AS-IS
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;
const DialogPortal = DialogPrimitive.Portal;

// OVERLAY: dims the page behind the dialog
function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-50 bg-black/40", className)}
      {...props}
    />
  );
}

// CONTENT: centered panel on the sidebar gray
function DialogContent({ className, children, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-3 rounded-lg border border-border bg-popover p-5 text-popover-foreground",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

// HEADER AND FOOTER LAYOUT
function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-1", className)} {...props} />;
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="dialog-footer" className={cn("flex justify-end gap-2", className)} {...props} />;
}

// TITLE AND DESCRIPTION (required by Radix for screen readers)
function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn("text-body font-semibold", className)} {...props} />;
}

function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-panel text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
