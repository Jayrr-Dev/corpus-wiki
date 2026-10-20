import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const rows = await db.query(
  `update article_suggestions set note = null
   where title = 'Enneagram and DSM-IV personality disorders' and status = 'applied'
     and note like 'Created, but its text is not fully written%'
   returning id`,
);
console.log(JSON.stringify(rows));
await db.close();
