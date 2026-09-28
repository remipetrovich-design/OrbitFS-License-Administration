import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../../lib/auth';
import {getSettings,sendPulse,updateRuntimePolicy} from '../../../../../lib/core/settings';

function publicState(s:any){
  return {
    pulse_revision:Number(s?.pulse_revision||0),
    pulse_at:s?.pulse_at??null,
    pulse_reason:s?.pulse_reason??null,
    runtime_policy:{
      validation_ttl_seconds:Number(s?.validation_ttl_seconds||60),
      offline_grace_seconds:Number(s?.offline_grace_seconds||0),
      pulse_poll_seconds:Number(s?.pulse_poll_seconds||15),
      max_failed_validations:Number(s?.max_failed_validations||3),
      allow_offline_grace:Boolean(s?.allow_offline_grace),
    },
    authority:{
      system_enabled:Boolean(s?.system_enabled),
      licensing_enabled:Boolean(s?.licensing_enabled),
      maintenance_mode:Boolean(s?.maintenance_mode),
      release_system_enabled:Boolean(s?.release_system_enabled),
      deployment_enabled:Boolean(s?.deployment_enabled),
      base_deployment_enabled:s?.base_deployment_enabled!==false,
      update_deployment_enabled:s?.update_deployment_enabled!==false,
      rollback_enabled:s?.rollback_enabled!==false,
    },
  };
}

export async function GET(){
  const s=await getSettings();
  return NextResponse.json(publicState(s),{headers:{'cache-control':'no-store'}});
}

export async function POST(request:Request){
  const auth=await integrationAuthorized(request,'license.manage');
  if(!auth)return NextResponse.json({error:'Unauthorized'},{status:401});
  const body=await request.json().catch(()=>({}));
  const action=String(body?.action||'pulse').trim().toLowerCase();
  if(action==='configure'){
    const row=await updateRuntimePolicy({
      validation_ttl_seconds:body.validation_ttl_seconds,
      offline_grace_seconds:body.offline_grace_seconds,
      pulse_poll_seconds:body.pulse_poll_seconds,
      max_failed_validations:body.max_failed_validations,
      allow_offline_grace:body.allow_offline_grace,
    },null,`api:${auth.name}`);
    return NextResponse.json({ok:true,action,...publicState(row)},{headers:{'cache-control':'no-store'}});
  }
  if(action!=='pulse')return NextResponse.json({error:'Unsupported pulse action'},{status:400});
  await sendPulse(null,`api:${auth.name}`,String(body?.reason||'manual-api-pulse'),{source:'api'});
  const row=await getSettings();
  return NextResponse.json({ok:true,action,...publicState(row)},{headers:{'cache-control':'no-store'}});
}
