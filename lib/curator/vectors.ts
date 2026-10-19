import type { DbRpc } from "@/lib/db/rpc";
import type { CuratorSnapshot } from "./curate";

// One statement cannot return every claim vector. Thirty-two 1024-number
// vectors stay inside the 8 second request limit.
const CURATOR_VECTOR_BATCH = 32;

export async function attachCuratorVectors(db: DbRpc, snapshot: CuratorSnapshot): Promise<CuratorSnapshot> {
  const ids = [...new Set([...snapshot.pages.flatMap((page) => page.claimIds), ...(snapshot.unplaced ?? []).map((claim) => claim.id)])];
  const vectors: CuratorSnapshot["vectors"] = [];
  for (let index = 0; index < ids.length; index += CURATOR_VECTOR_BATCH) {
    vectors.push(...await db.call<CuratorSnapshot["vectors"]>("curator_claim_vectors", { p_unit_ids: ids.slice(index, index + CURATOR_VECTOR_BATCH) }));
  }
  return { ...snapshot, vectors };
}
