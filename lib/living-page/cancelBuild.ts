import type { DbRpc } from "@/lib/db/rpc";

export class SectionBuildCancelled extends Error {
  constructor() { super("Section update cancelled."); }
}

const WRITES = new Set(["commit_change_set", "auto_accept_exceptions", "upload_workflow_write", "finish_section_build", "mark_section_stale"]);

export function cancellableBuildDb(db: DbRpc, sectionId: string, token: string): DbRpc {
  return {
    async call<T>(fn: string, args = {}): Promise<T> {
      if (!WRITES.has(fn) && fn !== "assert_section_build") return db.call<T>(fn, args);
      const result = await db.call<T & { buildCancelled?: boolean }>("section_build_write", {
        p_section_id: sectionId, p_token: token,
        p_function: fn === "assert_section_build" ? "assert" : fn, p_args: args,
      });
      if (result?.buildCancelled) throw new SectionBuildCancelled();
      return result;
    },
  };
}
