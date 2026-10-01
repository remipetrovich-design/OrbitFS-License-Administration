import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../lib/auth';
import {getSettings,setSetting,updateRuntimePolicy,type SettingField} from '../../../../lib/core/settings';
import {getEmergencyLockdown} from '../../../../lib/core/lockdown';

const fields:SettingField[]=['system_enabled','licensing_enabled','maintenance_mode','customer_self_unlock_enabled','release_system_enabled','deployment_enabled','base_deployment_enabled','update_deployment_enabled','rollback_enabled'];

export async function GET(request:Request){
 const actor=await integrationAuthorized(request,'license.manage');
 if(!actor)return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});
 return NextResponse.json({ok:true,settings:await getSettings(),lockdown:await getEmergencyLockdown()},{headers:{'cache-control':'no-store'}});
}

export async function PATCH(request:Request){
 const actor=await integrationAuthorized(request,'license.manage');
 if(!actor)return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});
 const body=await request.json().catch(()=>({}));
 const actorName='api:'+String(actor.name||'integration');
 try{
  for(const field of fields){
   if(typeof body[field]==='boolean')await setSetting(field,body[field],null,actorName);
  }
  if(['validation_ttl_seconds','offline_grace_seconds','pulse_poll_seconds','max_failed_validations','allow_offline_grace'].some(key=>body[key]!==undefined)){
   await updateRuntimePolicy(body,null,actorName);
  }
  return NextResponse.json({ok:true,settings:await getSettings(),lockdown:await getEmergencyLockdown()});
 }catch(error){return NextResponse.json({ok:false,code:'AUTHORITY_CONTROL_FAILED',error:error instanceof Error?error.message:'Authority control failed'},{status:400})}
}
