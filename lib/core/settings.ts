import { db } from '../db';

export type SettingField='system_enabled'|'licensing_enabled'|'maintenance_mode'|'customer_self_unlock_enabled'|'release_system_enabled'|'deployment_enabled'|'base_deployment_enabled'|'update_deployment_enabled'|'rollback_enabled';
export type RuntimePolicy={
  validation_ttl_seconds:number;
  offline_grace_seconds:number;
  pulse_poll_seconds:number;
  max_failed_validations:number;
  allow_offline_grace:boolean;
};

export async function getSettings() {
  return (await db().query('select * from system_settings where id=true')).rows[0];
}

export async function sendPulse(actorUserId:string|null,actor:string,reason:string,details:Record<string,unknown>={}) {
  const result=await db().query(
    `update system_settings
       set pulse_revision=coalesce(pulse_revision,0)+1,
           pulse_at=now(),
           pulse_reason=$1,
           updated_at=now()
     where id=true
     returning pulse_revision,pulse_at,pulse_reason,validation_ttl_seconds,offline_grace_seconds,pulse_poll_seconds,max_failed_validations,allow_offline_grace`,
    [String(reason||'manual').slice(0,160)],
  );
  const pulse=result.rows[0];
  await db().query(
    `insert into audit_events(actor_user_id,actor,action,resource_type,details)
     values($1,$2,'authority.pulse','system_settings',$3)`,
    [actorUserId,actor,JSON.stringify({reason:pulse.pulse_reason,pulse_revision:pulse.pulse_revision,...details})],
  );
  return pulse;
}

export async function setSetting(field:SettingField,value:boolean,actorUserId:string|null,actor:string) {
  const allowed:SettingField[]=['system_enabled','licensing_enabled','maintenance_mode','customer_self_unlock_enabled','release_system_enabled','deployment_enabled','base_deployment_enabled','update_deployment_enabled','rollback_enabled'];
  if(!allowed.includes(field))throw new Error('Unsupported authority setting');
  const before=await getSettings();
  const result=await db().query(`update system_settings set ${field}=$1, updated_at=now() where id=true returning *`,[value]);
  await db().query(
    `insert into audit_events(actor_user_id,actor,action,resource_type,details)
     values($1,$2,$3,'system_settings',$4)`,
    [actorUserId,actor,`settings.set.${field}`,JSON.stringify({field,previous:Boolean(before?.[field]),value})],
  );
  if(Boolean(before?.[field])!==value)await sendPulse(actorUserId,actor,`authority-setting:${field}`,{field,value});
  return result.rows[0];
}

export async function toggleSetting(field:SettingField,actorUserId:string,actor:string) {
  const current=await getSettings();
  return setSetting(field,!Boolean(current?.[field]),actorUserId,actor);
}

export async function updateRuntimePolicy(input:Partial<RuntimePolicy>,actorUserId:string|null,actor:string){
  const current=await getSettings();
  const clamp=(value:unknown,min:number,max:number,fallback:number)=>{
    const n=Number(value);
    return Number.isFinite(n)?Math.min(max,Math.max(min,Math.floor(n))):fallback;
  };
  const next:RuntimePolicy={
    validation_ttl_seconds:clamp(input.validation_ttl_seconds,5,86400,Number(current?.validation_ttl_seconds||60)),
    offline_grace_seconds:clamp(input.offline_grace_seconds,0,604800,Number(current?.offline_grace_seconds||0)),
    pulse_poll_seconds:clamp(input.pulse_poll_seconds,5,3600,Number(current?.pulse_poll_seconds||15)),
    max_failed_validations:clamp(input.max_failed_validations,1,100,Number(current?.max_failed_validations||3)),
    allow_offline_grace:input.allow_offline_grace===undefined?Boolean(current?.allow_offline_grace):Boolean(input.allow_offline_grace),
  };
  if(!next.allow_offline_grace)next.offline_grace_seconds=0;
  await db().query(
    `update system_settings set validation_ttl_seconds=$1,offline_grace_seconds=$2,pulse_poll_seconds=$3,max_failed_validations=$4,allow_offline_grace=$5,updated_at=now() where id=true`,
    [next.validation_ttl_seconds,next.offline_grace_seconds,next.pulse_poll_seconds,next.max_failed_validations,next.allow_offline_grace],
  );
  await db().query(
    `insert into audit_events(actor_user_id,actor,action,resource_type,details)
     values($1,$2,'settings.runtime_policy','system_settings',$3)`,
    [actorUserId,actor,JSON.stringify(next)],
  );
  await sendPulse(actorUserId,actor,'runtime-policy-changed',next);
  return await getSettings();
}
