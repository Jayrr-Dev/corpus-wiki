import {spawnSync} from 'node:child_process';
import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
const event='811105ea-fcfe-4ac4-9c7d-dc589b1501e4';
try{
 const [before]=await db.query(`select token,cancel_requested from upload_workflows where event_id='${event}'`);
 if(before.cancel_requested&&!process.argv.includes('--resume-cancelled'))throw Error('User cancellation is pending; leave it stopped.');
 const command=String.raw`
 $taskRoot='C:\Users\Main\Documents\Projects\second-brain-engine'
 $owners=@(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
 if($owners.Count -ne 1){throw 'Expected one server on port 3000'}
 $server=Get-CimInstance Win32_Process -Filter "ProcessId = $($owners[0])"
 if(-not $server.CommandLine.Contains($taskRoot+'\node_modules\next\dist\server\lib\start-server.js')){throw 'Port 3000 is not this workspace server'}
 $launcher=Get-CimInstance Win32_Process -Filter "ProcessId = $($server.ParentProcessId)"
 if($launcher.CommandLine -notmatch 'next dev --port 3000'){throw 'Unexpected server launcher'}
 Stop-Process -Id $launcher.ProcessId -ErrorAction Stop
 Stop-Process -Id $server.ProcessId -ErrorAction SilentlyContinue
 Write-Output 'Stopped the verified workspace server.'
 `;
 const stopped=spawnSync('powershell.exe',['-NoProfile','-Command',command],{encoding:'utf8',windowsHide:true});
 if(stopped.status!==0)throw Error(stopped.stderr||stopped.stdout);
 console.log(stopped.stdout.trim());
 if(before.token){
  if(!/^[0-9a-f-]{36}$/.test(before.token))throw Error('Invalid captured ownership token');
  await db.query(`begin; select set_config('request.headers','{"x-space-id":"21132c80-32b3-4ef2-9156-d9af60486173"}',true); select public.release_upload_workflow('${event}','${before.token}','incomplete',null); commit;`);
 }
 if(process.argv.includes('--resume-cancelled'))await db.query(`begin;
 select set_config('request.headers','{"x-space-id":"21132c80-32b3-4ef2-9156-d9af60486173"}',true);
 do $$declare result jsonb; begin
 result:=public.claim_upload_workflow('${event}',false);
 if coalesce((result->>'claimed')::boolean,false) then perform public.release_upload_workflow('${event}',(result->>'token')::uuid,'incomplete',null); end if;
 end$$; commit;`);
 if(process.argv.includes('--stop-only')){console.log('Released stopped ownership and preserved all checkpoints.');process.exit(0);}
 const start=String.raw`
 $taskRoot='C:\Users\Main\Documents\Projects\second-brain-engine'
 $runner=(Get-Command node.exe).Source
 $job=Start-Process -FilePath $runner -ArgumentList @('node_modules/next/dist/bin/next','dev','--port','3000') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput ($taskRoot+'\artifacts\verified-worker-stdout.log') -RedirectStandardError ($taskRoot+'\artifacts\verified-worker-stderr.log') -PassThru
 Write-Output ('Started refreshed server: '+$job.Id)
 `;
 const started=spawnSync('powershell.exe',['-NoProfile','-Command',start],{encoding:'utf8',windowsHide:true});
 if(started.status!==0)throw Error(started.stderr||started.stdout);
 console.log(started.stdout.trim());
}finally{await db.close();}
