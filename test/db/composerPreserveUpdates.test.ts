import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { ComposerRun, ComposerSnapshot } from "@/lib/composer/types";

it("hides outdated illustrations independently and restores them through undo without deleting history", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const page = (await pg.query<{ id: string }>("insert into pages(title,slug) values('Preserve images','preserve-images') returning id")).rows[0]!.id;
    const sections: string[] = [];
    const lines: string[] = [];
    for (let i = 0; i < 2; i++) {
      const section = (await pg.query<{ id: string }>("insert into sections(page_id,title,mode,query,position) values($1,$2,'generated','{}',$3) returning id", [page, `Section ${i}`, i])).rows[0]!.id;
      sections.push(section);
      const line = (await pg.query<{ id: string }>("select gen_random_uuid() id")).rows[0]!.id;
      lines.push(line);
      await pg.exec("begin; set constraints all deferred");
      const revision = (await pg.query<{ id: string }>("select gen_random_uuid() id")).rows[0]!.id;
      await pg.query("insert into lines(id,section_id,position,current_revision_id) values($1,$2,0,$3)", [line, section, revision]);
      await pg.query("insert into line_revisions(id,line_id,content,unit_revision_ids,author,event_id) values($1,$2,'Original text','{}','ai',(select id from shift_events limit 1))", [revision, line]);
      await pg.query("update lines set current_revision_id=$1 where id=$2", [revision, line]);
      await pg.exec("commit");
    }
    const snapshot = await db.call<ComposerSnapshot>("composer_page_snapshot", { p_page_id: page });
    const composition = { figures: lines.map((line, i) => ({ after: line, evidence: [line], svg: `<svg><desc>Figure ${i}</desc></svg>`, caption: `Figure ${i}`, alt: `Image ${i}`, learningGoal: `Goal ${i}` })), omitted: "" };
    const original = await db.call<string>("save_composer_run", { p_page_id: page, p_snapshot: snapshot, p_composition: composition, p_review: { approved: true }, p_model: "test" });
    const read = () => db.call<ComposerRun>("read_composer_run", { p_page_id: page });
    expect((await read()).composition.figures).toHaveLength(2);
    const draft = await db.call<{ changeSetId: string }>("submit_change_set", {
      p_event_id: null, p_cause: "edit", p_actor: "person", p_summary: "Change illustrated fact", p_trace: {},
      p_actions: [{ type: "revise_line", targetId: lines[0], expectedRevisionId: null, passageIds: [], speechAct: null,
        input: { content: "Changed fact", unitRevisionIds: [], expectedLineRevisionId: snapshot.paragraphs.find((p) => p.id === lines[0])!.revisionId } }],
    });
    await db.call("commit_change_set", { p_change_set_id: draft.changeSetId });
    const changed = await read();
    expect(changed.composition.figures).toHaveLength(1);
    expect(changed.composition.figures[0]).toMatchObject({ ...composition.figures[1], sourceIndex: 1, sectionId: sections[1] });
    expect(changed.omittedFigureCount).toBe(1);
    expect((await db.call<ComposerRun>("read_composer_reusable_run", { p_page_id: page })).composition.figures).toHaveLength(1);
    // Hidden drawings and their original evidence are immutable history.
    expect((await pg.query<{ snapshot: unknown; composition: unknown }>("select snapshot,composition from composer_runs where id=$1", [original])).rows[0]).toEqual({ snapshot, composition });
    await db.call("revert_change_set", { p_change_set_id: draft.changeSetId });
    expect((await read()).composition.figures).toHaveLength(2);
    // Removing a section cannot transplant its image into the other section.
    await pg.query("update sections set retired_at=now() where id=$1", [sections[0]]);
    expect((await read()).composition.figures.map((f) => f.after)).toEqual([lines[1]]);
    await pg.query("update sections set retired_at=null where id=$1", [sections[0]]);
    expect((await read()).composition.figures).toHaveLength(2);
    // A figure citing more than one paragraph requires every paragraph to survive.
    const combined = { ...composition, figures: [{ ...composition.figures[0]!, evidence: lines }] };
    const latest = await db.call<string>("save_composer_run", { p_page_id: page, p_snapshot: snapshot, p_composition: combined, p_review: {}, p_model: "test" });
    await pg.query("update lines set retired_at=now() where id=$1", [lines[1]]);
    expect((await read()).composition.figures).toEqual([]);
    await pg.query("update lines set retired_at=null where id=$1", [lines[1]]);
    await db.call("select_composer_run", { p_page_id: page, p_run_id: original });
    expect((await read()).composition.figures).toHaveLength(2);
    expect((await pg.query("select id from composer_runs where id=$1", [latest])).rows).toHaveLength(1);
    // The prose can stay unchanged while its underlying claim becomes obsolete.
    const claim = (await pg.query<{ id: string; current_revision_id: string }>("select id,current_revision_id from units where retired_at is null limit 1")).rows[0]!;
    await pg.exec("begin; set constraints all deferred");
    const citedRevision = (await pg.query<{ id: string }>("insert into line_revisions(line_id,content,unit_revision_ids,author,event_id) values($1,'Original text',array[$2::uuid],'ai',(select id from shift_events limit 1)) returning id", [lines[0], claim.current_revision_id])).rows[0]!.id;
    await pg.query("update lines set current_revision_id=$1 where id=$2", [citedRevision, lines[0]]);
    await pg.exec("commit");
    const citedSnapshot = await db.call<ComposerSnapshot>("composer_page_snapshot", { p_page_id: page });
    await db.call("save_composer_run", { p_page_id: page, p_snapshot: citedSnapshot, p_composition: { ...composition, figures: [composition.figures[0]] }, p_review: {}, p_model: "test" });
    expect((await read()).composition.figures).toHaveLength(1);
    await pg.query("update units set retired_at=now() where id=$1", [claim.id]);
    expect((await read()).composition.figures).toEqual([]);
    await pg.query("update units set retired_at=null where id=$1", [claim.id]);
    expect((await read()).composition.figures).toHaveLength(1);
    await db.call("select_composer_run", { p_page_id: page, p_run_id: null });
    expect(await read()).toBeNull();
  } finally { await pg.close(); }
});
