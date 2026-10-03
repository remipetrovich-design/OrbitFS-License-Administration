import { db } from '../db';

export type SettingField='system_enabled'|'licensing_enabled'|'maintenance_mode'|'customer_self_unlock_enabled'|'release_system_enabled'|'auto_technical_approval_enabled'|'deployment_enabled'|'base_deployment_enabled'|'update_deployment_enabled'|'rollback_enabled';
export type GithubProfileName='primary'|'fallback';
export type RuntimePolicy={
  validation_ttl_seconds:number;
  offline_grace_seconds:number;
  pulse_poll_seconds:number;
  max_failed_validations:number;
  allow_offline_grace:boolean;
};
export type PulseAction='full_recheck'|'revalidate_license'|'refresh_entitlements'|'refresh_binding'|'refresh_runtime_policy'|'refresh_authority'|'invalidate_cache'|'request_check_in'|'refresh_release_access';
export type PulseScope='global'|'product'|'license'|'installation'|'component';

const PULSE_ACTIONS:PulseAction[]=['full_recheck','revalidate_license','refresh_entitlements','refresh_binding','refresh_runtime_policy','refresh_authority','invalidate_cache','request_check_in','refresh_release_access'];
const PULSE_SCOPES:PulseScope[]=['global','product','license','installation','component'];

function pulseActionFromReason(reason:string):PulseAction{
  const value=String(reason||'').toLowerCase();
  if(value.includes('runtime-policy'))return 'refresh_runtime_policy';
  if(value.includes('authority-setting')||value.includes('authority-recheck'))return 'refresh_authority';
  if(value.includes('installation')||value.includes('binding'))return 'refresh_binding';
  if(value.includes('component')||value.includes('entitlement'))return 'refresh_entitlements';
  if(value.includes('release-access'))return 'refresh_release_access';
  if(value.includes('check-in'))return 'request_check_in';
  if(value.includes('invalidate-cache'))return 'invalidate_cache';
  if(value.includes('reactivated')||value.includes('license-active')||value.includes('full-license-recheck'))return 'full_recheck';
  if(value.includes('suspend')||value.includes('revoke')||value.includes('expired')||value.includes('terminate')||value.includes('deleted')||value.includes('key-rotated')||value.includes('validation-recheck'))return 'revalidate_license';
  return 'full_recheck';
}

function pulseScopeFromDetails(details:Record<string,unknown>):PulseScope{
  const explicit=String((details as any).pulse_scope||'').trim().toLowerCase() as PulseScope;
  if(PULSE_SCOPES.includes(explicit))return explicit;
  if((details as any).installation_id)return 'installation';
  if((details as any).license_id)return 'license';
  if((details as any).product)return 'product';
  if((details as any).component)return 'component';
  return 'global';
}

function cleanPulsePayload(details:Record<string,unknown>){
  const payload={...details} as Record<string,unknown>;
  delete payload.pulse_action;
  delete payload.pulse_scope;
  delete payload.requires_ack;
  delete payload.expires_at;
  return payload;
}

export async function getSettings() {
  return (await db().query('select * from system_settings where id=true')).rows[0];
}

export async function sendPulse(actorUserId:string|null,actor:string,reason:string,details:Record<string,unknown>={}) {
  const reasonText=String(reason||'manual').slice(0,160);
  const requestedAction=String((details as any).pulse_action||'').trim().toLowerCase() as PulseAction;
  const pulseAction:PulseAction=PULSE_ACTIONS.includes(requestedAction)?requestedAction:pulseActionFromReason(reasonText);
  const scope=pulseScopeFromDetails(details);
  const licenseId=(details as any).license_id?String((details as any).license_id):null;
  const installationId=(details as any).installation_id?String((details as any).installation_id):null;
  const product=(details as any).product?String((details as any).product).toLowerCase():null;
  const component=(details as any).component?String((details as any).component).toLowerCase():null;
  const requiresAck=(details as any).requires_ack===undefined?true:Boolean((details as any).requires_ack);
  const expiresAt=(details as any).expires_at?String((details as any).expires_at):null;
  const payload=cleanPulsePayload(details);

  const result=await db().query(
    `update system_settings
       set pulse_revision=coalesce(pulse_revision,0)+1,
           pulse_at=now(),
           pulse_reason=$1,
           updated_at=now()
     where id=true
     returning pulse_revision,pulse_at,pulse_reason,validation_ttl_seconds,offline_grace_seconds,pulse_poll_seconds,max_failed_validations,allow_offline_grace`,
    [reasonText],
  );
  const pulse=result.rows[0];
  let directive:any=null;
  try{
    directive=(await db().query(
      `insert into license_pulses(revision,action,scope,license_id,installation_id,product,component,reason,payload,requires_ack,created_by_user_id,created_by,expires_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning id,revision,action,scope,license_id,installation_id,product,component,reason,payload,requires_ack,created_at,expires_at`,
      [pulse.pulse_revision,pulseAction,scope,licenseId,installationId,product,component,reasonText,JSON.stringify(payload),requiresAck,actorUserId,actor,expiresAt],
    )).rows[0];
  }catch(error:any){
    if(error?.code!=='42P01')throw error;
  }
  await db().query(
    `insert into audit_events(actor_user_id,actor,action,resource_type,details)
     values($1,$2,'authority.pulse','system_settings',$3)`,
    [actorUserId,actor,JSON.stringify({reason:pulse.pulse_reason,pulse_revision:pulse.pulse_revision,pulse_action:pulseAction,pulse_scope:scope,license_id:licenseId,installation_id:installationId,product,component,...payload})],
  );
  return {...pulse,directive};
}

export async function listApplicablePulses(input:{sinceRevision?:number;licenseId?:string|null;installationId?:string|null;product?:string|null;component?:string|null;limit?:number}){
  const since=Math.max(0,Number.isFinite(Number(input.sinceRevision))?Math.floor(Number(input.sinceRevision)):0);
  const limit=Math.min(100,Math.max(1,Math.floor(Number(input.limit||50))));
  const params:any[]=[since];
  const applies:string[]=[`p.scope='global'`];
  const add=(value:any)=>{params.push(value);return '$'+params.length;};
  const licenseParam=input.licenseId?add(String(input.licenseId)):null;

  if(input.product){
    const productParam=add(String(input.product).toLowerCase());
    applies.push(`(p.scope='product' and p.product=${productParam})`);
  }
  if(licenseParam){
    applies.push(`(p.scope='license' and p.license_id::text=${licenseParam})`);
  }
  if(input.installationId){
    const installationParam=add(String(input.installationId));
    applies.push(`(p.scope='installation' and p.installation_id=${installationParam} and (p.license_id is null${licenseParam?` or p.license_id::text=${licenseParam}`:''}))`);
  }
  if(input.component){
    const componentParam=add(String(input.component).toLowerCase());
    applies.push(`(p.scope='component' and p.component=${componentParam} and (p.license_id is null${licenseParam?` or p.license_id::text=${licenseParam}`:''}))`);
  }

  const limitParam=add(limit);
  try{
    return (await db().query(
      `select p.id,p.revision,p.action,p.scope,p.license_id,p.installation_id,p.product,p.component,p.reason,p.payload,p.requires_ack,p.created_at,p.expires_at
       from license_pulses p
       where p.revision>$1
         and (p.expires_at is null or p.expires_at>now())
         and (${applies.join(' or ')})
       order by p.revision asc
       limit ${limitParam}`,
      params,
    )).rows;
  }catch(error:any){
    if(error?.code==='42P01')return [];
    throw error;
  }
}

function pulseAppliesToClient(pulse:any,input:{licenseId?:string|null;installationId:string;product?:string|null;component?:string|null}){
  const scope=String(pulse.scope||'global') as PulseScope;
  if(scope==='global')return true;
  if(scope==='product')return Boolean(input.product)&&String(input.product).toLowerCase()===String(pulse.product||'').toLowerCase();
  if(scope==='license')return Boolean(input.licenseId)&&String(input.licenseId)===String(pulse.license_id||'');
  if(scope==='installation')return String(input.installationId)===String(pulse.installation_id||'')&&(!pulse.license_id||String(input.licenseId||'')===String(pulse.license_id));
  if(scope==='component')return Boolean(input.component)&&String(input.component).toLowerCase()===String(pulse.component||'').toLowerCase()&&(!pulse.license_id||String(input.licenseId||'')===String(pulse.license_id));
  return false;
}

export async function acknowledgePulse(input:{
  pulseId?:string|null;
  revision?:number|null;
  licenseId?:string|null;
  installationId:string;
  product?:string|null;
  component?:string|null;
  client?:string|null;
  clientVersion?:string|null;
  status:'received'|'applied'|'failed';
  resultCode?:string|null;
  error?:string|null;
  resultingLicenseState?:string|null;
  resultingRevision?:number|null;
  details?:Record<string,unknown>;
}){
  const installationId=String(input.installationId||'').trim().slice(0,200);
  if(!installationId)throw Object.assign(new Error('installation_id is required'),{status:400,code:'INSTALLATION_ID_REQUIRED'});
  let pulse:any;
  try{
    if(input.pulseId){
      pulse=(await db().query('select * from license_pulses where id=$1 limit 1',[String(input.pulseId)])).rows[0];
    }else if(Number.isFinite(Number(input.revision))){
      pulse=(await db().query('select * from license_pulses where revision=$1 limit 1',[Math.floor(Number(input.revision))])).rows[0];
    }
  }catch(error:any){
    if(error?.code==='42P01')return {ok:true,skipped:true,reason:'PULSE_SCHEMA_NOT_AVAILABLE'};
    throw error;
  }
  if(!pulse)throw Object.assign(new Error('Pulse directive not found'),{status:404,code:'PULSE_NOT_FOUND'});
  if(!pulseAppliesToClient(pulse,{licenseId:input.licenseId,installationId,product:input.product,component:input.component})){
    throw Object.assign(new Error('Pulse directive does not apply to this installation'),{status:403,code:'PULSE_TARGET_MISMATCH'});
  }
  const status=input.status;
  const row=(await db().query(
    `insert into license_pulse_receipts(pulse_id,license_id,installation_id,client,client_version,status,result_code,error,resulting_license_state,resulting_revision,details,applied_at,updated_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,case when $6 in ('applied','failed') then now() else null end,now())
     on conflict(pulse_id,installation_id) do update set
       license_id=coalesce(excluded.license_id,license_pulse_receipts.license_id),
       client=coalesce(excluded.client,license_pulse_receipts.client),
       client_version=coalesce(excluded.client_version,license_pulse_receipts.client_version),
       status=excluded.status,
       result_code=excluded.result_code,
       error=excluded.error,
       resulting_license_state=excluded.resulting_license_state,
       resulting_revision=excluded.resulting_revision,
       details=license_pulse_receipts.details||excluded.details,
       applied_at=case when excluded.status in ('applied','failed') then now() else license_pulse_receipts.applied_at end,
       updated_at=now()
     returning pulse_id,installation_id,status,result_code,error,received_at,applied_at,updated_at`,
    [pulse.id,input.licenseId??null,installationId,input.client??null,input.clientVersion??null,status,input.resultCode??null,input.error??null,input.resultingLicenseState??null,input.resultingRevision??null,JSON.stringify(input.details??{})],
  )).rows[0];
  return {ok:true,receipt:row,pulse:{id:pulse.id,revision:Number(pulse.revision),action:pulse.action,scope:pulse.scope}};
}

export async function listRecentPulses(limit=20){
  const safeLimit=Math.min(100,Math.max(1,Math.floor(Number(limit)||20)));
  try{
    return (await db().query(
      `select p.id,p.revision,p.action,p.scope,p.license_id,p.installation_id,p.product,p.component,p.reason,p.requires_ack,p.created_at,p.expires_at,
              count(r.id)::int receipt_count,
              count(r.id) filter(where r.status='received')::int received_count,
              count(r.id) filter(where r.status='applied')::int applied_count,
              count(r.id) filter(where r.status='failed')::int failed_count,
              max(r.updated_at) last_receipt_at
       from license_pulses p
       left join license_pulse_receipts r on r.pulse_id=p.id
       group by p.id
       order by p.revision desc
       limit $1`,
      [safeLimit],
    )).rows;
  }catch(error:any){
    if(error?.code==='42P01')return [];
    throw error;
  }
}

export async function setSetting(field:SettingField,value:boolean,actorUserId:string|null,actor:string) {
  const allowed:SettingField[]=['system_enabled','licensing_enabled','maintenance_mode','customer_self_unlock_enabled','release_system_enabled','auto_technical_approval_enabled','deployment_enabled','base_deployment_enabled','update_deployment_enabled','rollback_enabled'];
  if(!allowed.includes(field))throw new Error('Unsupported authority setting');
  const before=await getSettings();
  const result=await db().query(`update system_settings set ${field}=$1, updated_at=now() where id=true returning *`,[value]);
  await db().query(
    `insert into audit_events(actor_user_id,actor,action,resource_type,details)
     values($1,$2,$3,'system_settings',$4)`,
    [actorUserId,actor,`settings.set.${field}`,JSON.stringify({field,previous:Boolean(before?.[field]),value})],
  );
  if(Boolean(before?.[field])!==value)await sendPulse(actorUserId,actor,`authority-setting:${field}`,{field,value,pulse_action:'refresh_authority',pulse_scope:'global'});
  return result.rows[0];
}

export async function toggleSetting(field:SettingField,actorUserId:string,actor:string) {
  const current=await getSettings();
  return setSetting(field,!Boolean(current?.[field]),actorUserId,actor);
}

export async function getGithubProfile():Promise<GithubProfileName>{
  const current=await getSettings();
  return String(current?.github_profile||'fallback').toLowerCase()==='primary'?'primary':'fallback';
}

export async function setGithubProfile(next:GithubProfileName,expected:GithubProfileName,actorUserId:string|null,actor:string){
  if(next!=='primary'&&next!=='fallback')throw new Error('Invalid GitHub profile');
  if(expected!=='primary'&&expected!=='fallback')throw new Error('Invalid current GitHub profile');
  if(next===expected)throw new Error('Requested GitHub profile is already active');
  const pool=db();
  const client=await pool.connect();
  try{
    await client.query('begin');
    const current=(await client.query('select system_enabled,github_profile from system_settings where id=true for update')).rows[0];
    const actual=String(current?.github_profile||'fallback').toLowerCase()==='primary'?'primary':'fallback';
    if(Boolean(current?.system_enabled))throw new Error('Master Authority must be OFF before changing MAIN/FALLBACK mode');
    if(actual!==expected)throw new Error('Source mode changed since this page was loaded. Refresh before switching.');
    const updated=(await client.query('update system_settings set github_profile=$1,updated_at=now() where id=true returning *',[next])).rows[0];
    await client.query(
      `insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details)
       values($1,$2,'github_profile.changed','system_settings','github_profile',$3)`,
      [actorUserId,actor,JSON.stringify({from:actual,to:next,master_authority_offline:true})],
    );
    await client.query('commit');
    return updated;
  }catch(error){
    await client.query('rollback').catch(()=>{});
    throw error;
  }finally{
    client.release();
  }
}

export async function updateRuntimePolicy(input:Partial<RuntimePolicy>,actorUserId:string|null,actor:string){
  const current=await getSettings();
  const clamp=(value:unknown,min:number,max:number,fallback:number)=>{
    const n=Number(value);
    return Number.isFinite(n)?Math.min(max,Math.max(min,Math.floor(n))):fallback;
  };
  const next:RuntimePolicy={
    validation_ttl_seconds:clamp(input.validation_ttl_seconds,60,86400,Number(current?.validation_ttl_seconds||5400)),
    offline_grace_seconds:clamp(input.offline_grace_seconds,0,604800,Number(current?.offline_grace_seconds||0)),
    pulse_poll_seconds:clamp(input.pulse_poll_seconds,60,86400,Number(current?.pulse_poll_seconds||5400)),
    max_failed_validations:clamp(input.max_failed_validations,1,100,Number(current?.max_failed_validations||3)),
    allow_offline_grace:input.allow_offline_grace===undefined?Boolean(current?.allow_offline_grace):Boolean(input.allow_offline_grace),
  };
  if(!next.allow_offline_grace)next.offline_grace_seconds=0;
  await db().query(
    `update system_settings set validation_ttl_seconds=$1,offline_grace_seconds=$2,pulse_poll_seconds=$3,max_failed_validations=$4,allow_offline_grace=$5,updated_at=now() where id=true returning *`,
    [next.validation_ttl_seconds,next.offline_grace_seconds,next.pulse_poll_seconds,next.max_failed_validations,next.allow_offline_grace],
  );
  await db().query(
    `insert into audit_events(actor_user_id,actor,action,resource_type,details)
     values($1,$2,'settings.runtime_policy','system_settings',$3)`,
    [actorUserId,actor,JSON.stringify(next)],
  );
  await sendPulse(actorUserId,actor,'runtime-policy-changed',{...next,pulse_action:'refresh_runtime_policy',pulse_scope:'global'});
  return await getSettings();
}
