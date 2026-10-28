"use client";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { GraphNode } from "@/lib/graph";
import { NODE_SCREENS } from "./nodeTypes";

// NODE PREVIEW: a clicked dot's key facts without leaving the graph, drawn by its kind's entry in NODE_SCREENS.
// Kinds that list units get a wide dialog with a knowledge-unit list on the right. A unit dialog stays a single column.
export function NodePreviewDialog({
  node,
  units = [],
  onClose,
}: {
  node: GraphNode | null;
  units?: readonly GraphNode[];
  onClose: () => void;
}) {
  const open = node !== null;
  const close = (isOpen: boolean) => (isOpen ? null : onClose());
  const screen = node ? NODE_SCREENS[node.kind] : null;
  if (!node || !screen?.listsUnits) {
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          {node && screen ? screen.preview(node, units) : null}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-5xl">
        {screen.preview(node, units)}
      </DialogContent>
    </Dialog>
  );
}
