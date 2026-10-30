# Claim embeddings results, 2026-10-29 (#39) — PARTIAL

Stopped early: the machine had to shut down. Only the "before" count was taken.

## Before the re-embed (read only, `scripts/reembed-claims.ts --pairs`)

Default space only (406 live claims, all text version 1):
- Cross-entity same wording: 7 pairs, 7 at or above cosine 0.85.
- Same-context candidates (other wording): 6 of 56 pairs at or above cosine 0.85.

## Not done yet

- The re-embed has NOT run. Every vector in every space is still text version 1 (bare text).
- Found: the live store has 3 spaces (406, 1,877 and 3 live claims). The script only sees the
  default space. It must loop spaces (`forEachWorkerSpace` in `lib/spaces/workers.ts`) before
  the re-embed runs, or the two other spaces re-embed during their next upload instead.
- Still to do: re-embed, `--pairs` again, `evals/retrieval` on main, compare with
  `docs/baseline-2026-10-29.md` (scoped hit@5 improves or holds; unscoped falls at most 1 point).
