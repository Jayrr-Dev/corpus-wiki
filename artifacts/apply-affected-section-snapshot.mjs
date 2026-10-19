import {runMigrations,readMigrationFiles} from '../scripts/db/migrate.ts';
import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try{const result=await runMigrations(db,{kind:'apply'},readMigrationFiles().filter(f=>f.version==='20261119006000'));console.log(JSON.stringify({applied:result.ran.map(f=>f.name)}));}finally{await db.close();}
