import {db} from '../db';

export const DEFAULT_LOCKDOWN_MESSAGE='OrbitFS is temporarily locked by system administration. Access is currently unavailable.';

export async function getEmergencyLockdown(){
 const row=(await db().query(
  `select emergency_lockdown,emergency_lockdown_message,emergency_lockdown_reason,emergency_lockdown_at,emergency_lockdown_by
   from system_settings where id=true`
 )).rows[0]||{};
 return {
  locked:Boolean(row.emergency_lockdown),
  message:String(row.emergency_lockdown_message||DEFAULT_LOCKDOWN_MESSAGE),
  reason:row.emergency_lockdown_reason||null,
  lockedAt:row.emergency_lockdown_at||null,
  lockedBy:row.emergency_lockdown_by||null,
 };
}

export async function enableEmergencyLockdown(actor:string,reason:string,message?:string|null){
 const safeReason=String(reason||'').trim().slice(0,500);
 if(!safeReason)throw new Error('Lockdown reason is required');
 const safeMessage=String(message||DEFAULT_LOCKDOWN_MESSAGE).trim().slice(0,1000)||DEFAULT_LOCKDOWN_MESSAGE;
 const row=(await db().query(
  `update system_settings
   set emergency_lockdown=true,
       emergency_lockdown_message=$1,
       emergency_lockdown_reason=$2,
       emergency_lockdown_at=now(),
       emergency_lockdown_by=$3,
       pulse_revision=coalesce(pulse_revision,0)+1,
       pulse_at=now(),
       pulse_reason='emergency-lockdown',
       updated_at=now()
   where id=true
   returning emergency_lockdown,emergency_lockdown_message,emergency_lockdown_reason,emergency_lockdown_at,emergency_lockdown_by,pulse_revision`,
  [safeMessage,safeReason,actor]
 )).rows[0];
 await db().query(
  `insert into audit_events(actor,action,resource_type,resource_id,details)
   values($1,'authority.emergency_lockdown.enable','system_settings','global',$2)`,
  [actor,JSON.stringify({reason:safeReason,message:safeMessage,pulse_revision:Number(row?.pulse_revision||0)})]
 );
 try{
  await db().query(
   `insert into license_pulses(revision,action,scope,reason,payload,requires_ack,created_by,created_at)
    values($1,'refresh_authority','global',$2,$3,true,$4,now())`,
   [Number(row?.pulse_revision||0),'emergency-lockdown',JSON.stringify({authority_lockdown:true,code:'AUTHORITY_LOCKDOWN',message:safeMessage}),actor]
  );
 }catch(error:any){if(error?.code!=='42P01')throw error}
 return getEmergencyLockdown();
}

export async function disableEmergencyLockdown(actor:string,reason?:string|null){
 const previous=await getEmergencyLockdown();
 const unlockReason=String(reason||'Owner recovery').trim().slice(0,500)||'Owner recovery';
 const row=(await db().query(
  `update system_settings
   set emergency_lockdown=false,
       emergency_lockdown_reason=null,
       emergency_lockdown_at=null,
       emergency_lockdown_by=null,
       pulse_revision=coalesce(pulse_revision,0)+1,
       pulse_at=now(),
       pulse_reason='emergency-lockdown-cleared',
       updated_at=now()
   where id=true
   returning pulse_revision`
 )).rows[0];
 await db().query(
  `insert into audit_events(actor,action,resource_type,resource_id,details)
   values($1,'authority.emergency_lockdown.disable','system_settings','global',$2)`,
  [actor,JSON.stringify({reason:unlockReason,previous,pulse_revision:Number(row?.pulse_revision||0)})]
 );
 try{
  await db().query(
   `insert into license_pulses(revision,action,scope,reason,payload,requires_ack,created_by,created_at)
    values($1,'refresh_authority','global',$2,$3,true,$4,now())`,
   [Number(row?.pulse_revision||0),'emergency-lockdown-cleared',JSON.stringify({authority_lockdown:false}),actor]
  );
 }catch(error:any){if(error?.code!=='42P01')throw error}
 return getEmergencyLockdown();
}
