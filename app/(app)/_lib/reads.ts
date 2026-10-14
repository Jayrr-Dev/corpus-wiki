// READ STATE: several queries shown as one (pending until all are in, the first error wins)
type Read = { isPending: boolean; error: Error | null };

export function readsState(reads: readonly Read[]): Read {
  return { isPending: reads.some((read) => read.isPending), error: reads.find((read) => read.error)?.error ?? null };
}
