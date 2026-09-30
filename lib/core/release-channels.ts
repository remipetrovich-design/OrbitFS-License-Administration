import { db } from '../db';

export type ReleaseChannel = {
  id:string; channel:string; label:string; description:string; enabled:boolean; customer_visible:boolean; access_mode:'open'|'closed'; access_request_enabled:boolean; self_join_enabled:boolean;
  sort_order:number; created_at:string; updated_at:string;
};
const NAME=/^[a-z0-9][a-z0-9_-]{0,31}$/;

export async function listReleaseChannels(includeDisabled=true):Promise<ReleaseChannel[]>{
  const where=includeDisabled?'':'where enabled=true';
  return (await db().query(`select * from release_channels ${where} order by sort_order,channel`)).rows;
}
export async function getReleaseChannel(channel:string):Promise<ReleaseChannel|null>{
  const key=String(channel||'').trim().toLowerCase();
  if(!NAME.test(key))return null;
  return (await db().query('select * from release_channels where channel=$1 limit 1',[key])).rows[0]??null;
}
export async function requireReleaseChannel(channel:string,opts?:{allowDisabled?:boolean}){
  const key=String(channel||'').trim().toLowerCase();
  if(!NAME.test(key))throw new Error('Invalid release channel');
  const row=await getReleaseChannel(key);
  if(!row)throw new Error(`Release channel "${key}" is not configured`);
  if(!opts?.allowDisabled&&!row.enabled)throw new Error(`Release channel "${key}" is disabled`);
  return row;
}
export async function saveReleaseChannel(input:{
  channel:string;label:string;description?:string;enabled?:boolean;customerVisible?:boolean;accessMode?:'open'|'closed';accessRequestEnabled?:boolean;selfJoinEnabled?:boolean;sortOrder?:number;
  actorUserId?:string|null;actor?:string;
}){
  const channel=String(input.channel||'').trim().toLowerCase(),label=String(input.label||'').trim();
  if(!NAME.test(channel))throw new Error('Channel must use lowercase letters, numbers, hyphens or underscores (max 32 characters)');
  if(!label)throw new Error('Channel label is required');
  const accessMode=input.accessMode??(channel==='stable'?'open':'closed');
  const accessRequestEnabled=input.accessRequestEnabled===true;
  const selfJoinEnabled=input.selfJoinEnabled===true;
  const row=(await db().query(
    `insert into release_channels(channel,label,description,enabled,customer_visible,sort_order,access_mode,access_request_enabled,self_join_enabled)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict(channel) do update set label=excluded.label,description=excluded.description,enabled=excluded.enabled,
       customer_visible=excluded.customer_visible,sort_order=excluded.sort_order,access_mode=excluded.access_mode,
       access_request_enabled=excluded.access_request_enabled,self_join_enabled=excluded.self_join_enabled,updated_at=now()
     returning *`,
    [channel,label,String(input.description||''),input.enabled!==false,input.customerVisible!==false,Number.isFinite(input.sortOrder)?Math.max(0,Math.round(input.sortOrder!)):100,accessMode,accessRequestEnabled,selfJoinEnabled]
  )).rows[0] as ReleaseChannel;
  await db().query(
    `insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details)
     values($1,$2,'release-channel.save','release_channel',$3,$4)`,
    [input.actorUserId??null,input.actor??'admin',row.id,JSON.stringify({channel,label,enabled:row.enabled,customer_visible:row.customer_visible,access_mode:row.access_mode})]
  );
  return row;
}
