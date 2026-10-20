import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const [counts] = await db.query(
  "select (select count(*)::int from section_knowledge) as rows, (select used_unit_count from knowledge_usage) as used",
);
console.log(JSON.stringify(counts));
await db.close();
