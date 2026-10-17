import type { DecisionSnapshot } from "./decider";
export function manualDomainPlan(snapshot:DecisionSnapshot,path:string,mode:"move"|"remove",destination:string) {
 const domains=snapshot.domains.filter(d=>!d.retired_at),source=domains.find(d=>d.path===path);
 if(!source)throw new Error("Domain no longer exists. Reopen the menu.");
 const parent=domains.find(d=>d.id===source.parent_id);
 if(!parent)throw new Error("Root domains cannot be moved or removed here.");
 if(mode==="move"){
  const target=domains.find(d=>d.path===destination);
  if(!target||target.path===path||target.path.startsWith(path+"/"))throw new Error("Choose a parent outside this domain's own subtree.");
  if(target.id===parent.id)throw new Error("This is already the parent domain.");
  if(target.path.split("/")[0]!==path.split("/")[0]||target.context_entity_id!==source.context_entity_id)throw new Error("Keep domains within the same organization.");
  return [{operation:"move",sourcePath:path,destinationPath:destination}];
 }
 const claimIds=snapshot.unitDomains.filter(m=>m.domain_id===source.id).map(m=>m.unit_id);
 const operations: object[]=[];
 if(claimIds.length)operations.push({operation:"assign",sourcePath:path,destinationPath:parent.path,claimIds});
 for(const child of domains.filter(d=>d.parent_id===source.id)) operations.push({operation:"move",sourcePath:child.path,destinationPath:parent.path});
 operations.push({operation:"delete",sourcePath:path});
 if(operations.length>40)throw new Error("This domain has too many children for one removal. Move some children first.");
 return operations;
}
