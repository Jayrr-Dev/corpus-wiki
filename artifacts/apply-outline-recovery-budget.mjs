import {runMigrations,readMigrationFiles} from '../scripts/db/migrate.ts';
import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try {
 const report=await runMigrations(db,{kind:'status'});
 console.log('Pending:',report.pending.map(file=>file.name).join(', '));
 const own=readMigrationFiles().filter(file=>file.version==='20261119003000');
 const applied=await runMigrations(db,{kind:'apply'},own);
 console.log('Applied:',applied.ran.map(file=>file.name).join(', ')||'already applied');
}finally{await db.close();}
