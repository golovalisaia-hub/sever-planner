// Keep authenticated AI writes compatible with v55 field registers. The caller
// also uses a metadata equality precondition, so a read/write race fails safely.
export function versionedPatch(table:string,row:any,patch:any,now:number=Date.now()) {
  if(row.sync_versions?.v!==1)return patch;
  const meta=structuredClone(row.sync_versions);
  const clock=Math.max(now,...[meta.life.stamp,...Object.values(meta.fields)].map((s:any)=>Number(s[0])+1));
  const stamp=[clock,crypto.randomUUID()];
  const groups:any=table==='tasks'
    ? {title:['title'],date:['scheduled_for'],time:['scheduled_time'],duration:['duration_minutes'],category:['category'],priority:['priority'],challenge:['challenge'],completion:['completed','completed_at']}
    : {folder:['folder_id'],content:['title','body','kind','items','done','protected','secure']};
  for(const [key,fields] of Object.entries(groups))if((fields as string[]).some(k=>k in patch&&JSON.stringify(row[k])!==JSON.stringify(patch[k])))meta.fields[key]=stamp;
  if(patch.deleted_at)meta.life={...meta.life,deleted:true,stamp};
  return {...patch,updated_at:new Date(clock).toISOString(),sync_versions:meta};
}
