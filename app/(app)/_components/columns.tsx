import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { TextLink } from "@/app/(app)/_components/bits";
import { DateTime } from "@/app/(app)/_components/DateTime";
import { formatCount, formatDate } from "@/app/(app)/_lib/format";
import type { Tone } from "@/app/(app)/_lib/tone";

// =====================================================================
// COLUMN HELPERS: the column shapes every table repeats (a link, a date,
// a status dot, plain text). Each sorts and filters on a plain value.
// =====================================================================

type Column<T> = ColumnDef<T, unknown>;

// LINK COLUMN: the row's main text, linking to its detail page
export function linkColumn<T>(id: string, header: string, text: (row: T) => string, href: (row: T) => string): Column<T> {
  return {
    id,
    header,
    accessorFn: text,
    cell: ({ row }) => (
      <TextLink href={href(row.original)} className="whitespace-normal">
        {text(row.original)}
      </TextLink>
    ),
  };
}

// DATE COLUMN: mono day (or day and time), sorted by the ISO string
export function dateColumn<T>(id: string, header: string, value: (row: T) => string | null, withTime = false): Column<T> {
  return {
    id,
    header,
    accessorFn: (row) => value(row) ?? "",
    cell: ({ row }) => {
      const iso = value(row.original);
      return <span className="font-mono text-muted-foreground">{withTime ? <DateTime iso={iso} /> : formatDate(iso)}</span>;
    },
  };
}

// STATUS COLUMN: a dot in the status's tone and the status in words
export function statusColumn<T, S extends string>(header: string, value: (row: T) => S, tones: Record<S, Tone>): Column<T> {
  return {
    id: "status",
    header,
    accessorFn: value,
    cell: ({ row }) => <StatusDot tone={tones[value(row.original)]} label={value(row.original)} />,
  };
}

// TEXT COLUMN: plain value, optionally rendered differently
export function textColumn<T>(id: string, header: string, value: (row: T) => string, render?: (row: T) => ReactNode): Column<T> {
  return {
    id,
    header,
    accessorFn: value,
    cell: ({ row }) => (render ? render(row.original) : value(row.original)),
  };
}

// COUNT COLUMN: a number in mono, sorted by its number
export function countColumn<T>(id: string, header: string, value: (row: T) => number | null): Column<T> {
  return textColumn<T>(id, header, (row) => String(value(row) ?? 0).padStart(12, "0"), (row) => <span className="font-mono">{formatCount(value(row))}</span>);
}
