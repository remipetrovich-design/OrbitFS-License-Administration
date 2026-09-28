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
