import type { StakeholderCard } from "@/lib/stakeholders/cards";
import type { StructureRelation } from "@/lib/stakeholders/structure";

// POWER STAND-IN: same signature as computePower in lib/stakeholders/power.ts (the power lane),
// used until that module lands. The level comes from how much knowledge mentions the party
// plus how many links point at it; every result is an estimate.
export type PowerResult = { score: number; level: number; reasons: string[]; estimated: boolean };

const LEVEL_FLOORS = [0, 5, 15, 40, 100];

export function computePower(cards: StakeholderCard[], relations: StructureRelation[]): Map<string, PowerResult> {
  const incoming = new Map<string, number>();
  for (const relation of relations) if (relation.current) incoming.set(relation.toId, (incoming.get(relation.toId) ?? 0) + 1);
  return new Map(cards.map((card) => {
    const links = incoming.get(card.entityId) ?? 0;
    const score = card.claimCount + links * 5;
    const level = LEVEL_FLOORS.filter((floor) => score >= floor).length;
    const reasons = [`Mentioned in ${card.claimCount} claim${card.claimCount === 1 ? "" : "s"}`];
    if (links) reasons.push(`${links} link${links === 1 ? "" : "s"} point${links === 1 ? "s" : ""} at it`);
    return [card.entityId, { score, level, reasons, estimated: true }];
  }));
}
