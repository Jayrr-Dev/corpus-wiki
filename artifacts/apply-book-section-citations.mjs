import {targetFromEnvironment} from '../scripts/db/targets.ts';
import {readMigrationFiles,runMigrations} from '../scripts/db/migrate.ts';
const db=await targetFromEnvironment(process.env);
try{
 const files=readMigrationFiles();
 const status=await runMigrations(db,{kind:'status'},files);
 console.log('Pending',JSON.stringify(status.pending.map(file=>`${file.version}_${file.name}`)));
 const selected=files.filter(file=>file.version==='20261118236000'&&file.name==='narrow_section_citations');
 if(selected.length!==1)throw Error('Expected the exact reviewed Composer migration');
 const result=await runMigrations(db,{kind:'apply'},selected);
 console.log('Applied',JSON.stringify(result.ran.map(file=>`${file.version}_${file.name}`)));
}finally{await db.close();}

