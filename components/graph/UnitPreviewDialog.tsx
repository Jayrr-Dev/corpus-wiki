"use client";

import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import type { GraphNode } from "@/lib/graph";
import { DomainPreview, EntityPreview, PagePreview } from "./NodePreviews";
import { UnitPreview } from "./UnitPreview";

// UNIT PREVIEW: a clicked unit's key facts (status, claim, domains, entities) without leaving the graph.
// Other kinds keep a knowledge-unit list on the right. A unit dialog stays a single column.
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
  if (!node || node.kind === "unit") {
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          {node ? <UnitPreview key={node.id} node={node} /> : null}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-5xl">
        {node.kind === "entity" ? (
          <EntityPreview key={node.id} node={node} units={units} />
        ) : null}
        {node.kind === "domain" ? (
          <DomainPreview key={node.id} node={node} units={units} />
        ) : null}
        {node.kind === "page" ? (
          <PagePreview key={node.id} node={node} units={units} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
