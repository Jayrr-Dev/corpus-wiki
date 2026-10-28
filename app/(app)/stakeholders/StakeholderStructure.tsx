"use client";

import Link from "next/link";
import { Network } from "lucide-react";
import { useState } from "react";
import { Tooltip } from "@/components/standard/tooltip";
import { cn } from "@/lib/utils";
import type { Power } from "./power";
import { PowerBadge } from "./StakeholderCard";
import { type PressureLine, staleYear, type Structure, type StructureBox, type StructureMember, yearsText } from "./structureTree";

const MEMBER_ROLES: Record<StructureMember["role"], string> = { owner: "Owner", leader: "Leads", board: "Board", member: "" };

// overUs: power over our work, null when no organization is marked as ours
type Levels = { power: Map<string, Power>; overUs: Map<string, Power> | null };
type BoxProps = Levels & { showFormer: boolean };

// STRUCTURE VIEW: organizations as boxes inside boxes (owners and leaders on top, then people,
// then former people when asked, then smaller boxes); pressure links as a short line on the box
// that presses
export function StakeholderStructure({ structure, power, overUs }: Levels & { structure: Structure }) {
  const [showFormer, setShowFormer] = useState(false);
  if (!structure.boxes.length) {
    return (
      <div className="py-16 text-center">
        <Network className="mx-auto mb-4 size-7 text-muted-foreground" />
        <p className="text-panel font-medium">No structure yet</p>
        <p className="mt-2 text-sm text-muted-foreground">New uploads label who is part of, owns, leads or works in what; the map fills in from those.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <label className="flex w-fit items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={showFormer} onChange={(event) => setShowFormer(event.target.checked)} className="accent-link" />
        Show former
      </label>
      <ul className="grid items-start gap-3 xl:grid-cols-2">
        {structure.boxes.map((box) => <li key={box.entityId}><Box box={box} power={power} overUs={overUs} showFormer={showFormer} /></li>)}
      </ul>
      {structure.loose.length > 0 && (
        <section aria-label="No known structure" className="space-y-2 border-t pt-5">
          <h2 className="text-sm font-semibold">No known structure <span className="font-normal text-faint">{structure.loose.length}</span></h2>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {structure.loose.map((entry) => <StakeholderLink key={entry.entityId} id={entry.entityId} name={entry.name} />)}
          </p>
        </section>
      )}
    </div>
  );
}

function Box({ box, power, overUs, showFormer }: BoxProps & { box: StructureBox }) {
  return (
    <section aria-label={box.name} className="space-y-2 rounded-lg border bg-card p-3">
      <header className="flex items-center justify-between gap-2">
        <StakeholderLink id={box.entityId} name={box.name} className="truncate text-sm font-semibold" />
        <Badges id={box.entityId} power={power} overUs={overUs} />
      </header>
      <Pressure lines={box.pressure} />
      {box.leaders.length > 0 && <Members members={box.leaders} power={power} overUs={overUs} />}
      {box.people.length > 0 && <Members members={box.people} power={power} overUs={overUs} muted />}
      {showFormer && box.former.length > 0 && <Members members={box.former} power={power} overUs={overUs} former />}
      {box.boxes.length > 0 && (
        <ul className="space-y-2">
          {box.boxes.map((child) => <li key={child.entityId}><Box box={child} power={power} overUs={overUs} showFormer={showFormer} /></li>)}
        </ul>
      )}
    </section>
  );
}

function Members({ members, power, overUs, muted, former }: Levels & { members: StructureMember[]; muted?: boolean; former?: boolean }) {
  return (
    <ul className={cn("space-y-0.5 text-xs", (muted || former) && "text-muted-foreground", former && "opacity-60")} aria-label={former ? "Former" : undefined}>
      {members.map((member) => {
        const seat = [MEMBER_ROLES[member.role], member.title].filter(Boolean).join(" · ");
        // A former seat reads "Former · Director, 2016 to 2021"
        const role = former ? ["Former", [seat, yearsText(member.since, member.until)].filter(Boolean).join(", ")].filter(Boolean).join(" · ") : seat;
        const asOf = former ? null : staleYear(member.asOf);
        const who = (
          <span className="flex min-w-0 items-center gap-1.5">
            <StakeholderLink id={member.entityId} name={member.name} className={muted || former ? undefined : "font-medium"} />
            {role && <span className="truncate text-faint">{role}</span>}
            {member.reportsTo.length > 0 && <span className="truncate text-faint">reports to {member.reportsTo.join(", ")}</span>}
          </span>
        );
        return (
          <li key={member.entityId} className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              {asOf ? <Tooltip content={`As of ${asOf}: the newest source that says so`}>{who}</Tooltip> : who}
              <span className="ml-auto"><Badges id={member.entityId} power={power} overUs={overUs} /></span>
            </div>
            <Pressure lines={member.pressure} />
          </li>
        );
      })}
    </ul>
  );
}

// General power, then power over our work when we know who we are
function Badges({ id, power, overUs }: Levels & { id: string }) {
  const general = power.get(id);
  const ours = overUs?.get(id);
  return (
    <span className="flex shrink-0 gap-1 text-xs">
      {general && <PowerBadge power={general} />}
      {ours && <PowerBadge power={ours} overUs />}
    </span>
  );
}

function Pressure({ lines }: { lines: PressureLine[] }) {
  if (!lines.length) return null;
  return (
    <ul className="space-y-0.5 text-xs text-muted-foreground">
      {lines.map((line) => (
        <li key={`${line.link}:${line.targetId}`}>{line.label} <StakeholderLink id={line.targetId} name={line.targetName} /></li>
      ))}
    </ul>
  );
}

function StakeholderLink({ id, name, className }: { id: string; name: string; className?: string }) {
  return <Link href={`/stakeholders/${id}`} className={cn("hover:underline", className)}>{name}</Link>;
}
