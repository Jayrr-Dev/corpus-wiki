import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const space = "21132c80-32b3-4ef2-9156-d9af60486173";
const run = async (label, sql) => {
  try {
    console.log(label, JSON.stringify(await db.query(sql)));
  } catch (error) {
    console.log(label, "FAILED", error.message);
  }
};
await run(
  "new title",
  `begin; insert into pages (title, slug, space_id) values ('Zz probe page', 'zz-probe-page', '${space}'); select count(*)::int from pages where title = 'Zz probe page'; rollback;`,
);
await run(
  "taken title",
  `begin; insert into pages (title, slug, space_id) values (' avoidant personality disorder', 'zz-probe-dupe', '${space}'); rollback;`,
);
await db.close();
