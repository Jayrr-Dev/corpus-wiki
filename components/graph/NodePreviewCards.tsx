"use client";

import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GraphNode } from "@/lib/graph";
import { NodePreviewBody } from "./UnitPreviewDialog";

// =====================================================================
// NODE PREVIEW CARDS: a clicked node's preview floats beside the click,
// with no overlay, so the graph stays usable and several can be open at
// once. Drag a card by its header; the one touched last sits on top.
// =====================================================================

// At most this many cards; opening one more closes the oldest
const MAX_CARDS = 5;
// Card size used to keep a new card inside the window, in pixels
const CARD_WIDTH = 384;
const CARD_HEIGHT = 360;
// Gap between the click and the card, and from the window edge, in pixels
const GAP = 16;

type Card = { node: GraphNode; x: number; y: number };

// Cards plus where the pointer last went down, so a new card opens beside the click
export function useNodePreviewCards() {
  const [cards, setCards] = useState<Card[]>([]);
  const pointer = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const track = (event: PointerEvent) => { pointer.current = { x: event.clientX, y: event.clientY }; };
    window.addEventListener("pointerdown", track, true);
    return () => window.removeEventListener("pointerdown", track, true);
  }, []);
  const open = useCallback((node: GraphNode) => {
    setCards((previous) => {
      // An open node comes to the front instead of opening twice
      const existing = previous.find((card) => card.node.id === node.id);
      if (existing) return [...previous.filter((card) => card !== existing), existing];
      const x = Math.max(GAP, Math.min(pointer.current.x + GAP, window.innerWidth - CARD_WIDTH - GAP));
      const y = Math.max(GAP, Math.min(pointer.current.y + GAP, window.innerHeight - CARD_HEIGHT - GAP));
      return [...previous, { node, x, y }].slice(-MAX_CARDS);
    });
  }, []);
  return { cards, setCards, open };
}

export function NodePreviewCards({ cards, setCards }: { cards: Card[]; setCards: (update: (previous: Card[]) => Card[]) => void }) {
  if (cards.length === 0) return null;
  const close = (id: string) => setCards((previous) => previous.filter((card) => card.node.id !== id));
  const front = (id: string) => setCards((previous) => {
    const card = previous.find((other) => other.node.id === id);
    return !card || previous.at(-1) === card ? previous : [...previous.filter((other) => other !== card), card];
  });
  const move = (id: string, x: number, y: number) => setCards((previous) => previous.map((card) => (card.node.id === id ? { ...card, x, y } : card)));
  return createPortal(
    // A stable DOM order, so bringing a card forward (z-index only) never moves its element and resets its scroll
    <>{[...cards].sort((a, b) => a.node.id.localeCompare(b.node.id)).map((card) => (
      <PreviewCard key={card.node.id} card={card} z={cards.indexOf(card)} onClose={() => close(card.node.id)} onFront={() => front(card.node.id)} onMove={(x, y) => move(card.node.id, x, y)} />
    ))}</>,
    document.body,
  );
}

// ONE CARD: fixed in the window, below dialogs (z-50) so a Sources dialog opens over it
function PreviewCard({ card, z, onClose, onFront, onMove }: { card: Card; z: number; onClose: () => void; onFront: () => void; onMove: (x: number, y: number) => void }) {
  // Drag from the header only, so the text stays selectable
  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    onFront();
    const target = event.target as HTMLElement;
    if (!target.closest("[data-drag-handle]") || target.closest("a,button")) return;
    event.preventDefault();
    const start = { x: event.clientX - card.x, y: event.clientY - card.y };
    const drag = (moveEvent: PointerEvent) => onMove(moveEvent.clientX - start.x, Math.max(0, moveEvent.clientY - start.y));
    const stop = () => { window.removeEventListener("pointermove", drag); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", drag);
    window.addEventListener("pointerup", stop);
  };
  return (
    <div
      role="dialog"
      aria-label={card.node.label}
      onPointerDown={startDrag}
      style={{ left: card.x, top: card.y, width: CARD_WIDTH, zIndex: 40 + z }}
      className="fixed max-h-[70vh] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl bg-popover p-4 text-panel text-popover-foreground shadow-lg ring-1 ring-foreground/10"
    >
      <NodePreviewBody node={card.node} />
      <Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" onClick={onClose}>
        <XIcon />
        <span className="sr-only">Close</span>
      </Button>
    </div>
  );
}
