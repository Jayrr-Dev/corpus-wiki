"use client";

import { TextLink } from "@/app/(app)/_components/bits";
import { useTimeZone } from "@/app/(app)/_components/DateTime";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isDue, LEVEL_LABELS, LEVELS, levelCounts, levelLabel } from "@/lib/study/levels";
import { claimStandings } from "@/lib/study/session";
import type { StudySetRow, StudySetsData } from "@/lib/study/types";
import { LEVEL_TONE } from "../LevelBar";

// COVERAGE RING: claims practiced out of all the set's claims
function CoverageRing({ practiced, total }: { practiced: number; total: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const share = total ? practiced / total : 0;
  return (
    <div className="relative size-24 shrink-0">
      <svg viewBox="0 0 80 80" className="size-24 -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="7" className="stroke-muted" />
        <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="7" strokeLinecap="round" className="stroke-link" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - share)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-semibold">{practiced} / {total}</span>
        <span className="text-xs text-muted-foreground">practiced</span>
      </div>
    </div>
  );
}

// PROGRESS: coverage reached, how many claims sit at each level, and each claim's level and next review
export function ProgressPanel({ set, data }: { set: StudySetRow; data: StudySetsData }) {
  const timeZone = useTimeZone();
  const now = new Date();
  const standings = claimStandings(data, set.id);
  const levels = levelCounts(standings.map((claim) => claim.unitId), new Map(standings.map((claim) => [claim.unitId, claim])));
  const practiced = standings.filter((claim) => claim.dueAt).length;
  const nextReview = (dueAt: string | null) => !dueAt || isDue({ dueAt }, now) ? "Now" : new Date(dueAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", timeZone });

  if (!standings.length) return <p className="text-panel text-muted-foreground">No questions yet.</p>;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-8">
        <CoverageRing practiced={practiced} total={standings.length} />
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          {LEVELS.map((level) => (
            <div key={level} className="flex flex-col">
              <dt className="flex items-center gap-1.5 text-panel text-muted-foreground"><span className={`size-2 rounded-full ${LEVEL_TONE[level]}`} aria-hidden />{LEVEL_LABELS[level]}</dt>
              <dd className="text-lg font-semibold">{levels[level]}</dd>
            </div>
          ))}
        </dl>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Claim</TableHead>
            <TableHead className="w-28">Level</TableHead>
            <TableHead className="w-48">Next review</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {standings.map((claim) => (
            <TableRow key={claim.unitId}>
              <TableCell className="whitespace-normal"><TextLink href={`/units/${claim.unitId}`}>{claim.title || claim.content}</TextLink></TableCell>
              <TableCell>{levelLabel(claim.level)}</TableCell>
              <TableCell suppressHydrationWarning>{nextReview(claim.dueAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
