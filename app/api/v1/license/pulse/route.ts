import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../../lib/auth';
import {acknowledgePulse,getSettings,listApplicablePulses,sendPulse,updateRuntimePolicy} from '../../../../../lib/core/settings';

function publicState(s:any){
  return {
    protocol_version:2,
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

export async function GET(request:Request){
  const s=await getSettings();
  const url=new URL(request.url);
  const sinceRaw=url.searchParams.get('since_revision');
  const hasSince=sinceRaw!==null&&sinceRaw!=='';
  const sinceRevision=hasSince?Math.max(0,Math.floor(Number(sinceRaw)||0)):Number(s?.pulse_revision||0);
  const licenseId=url.searchParams.get('license_id');
  const installationId=url.searchParams.get('installation_id');
  const product=url.searchParams.get('product');
  const component=url.searchParams.get('component');
  const directives=hasSince?await listApplicablePulses({sinceRevision,licenseId,installationId,product,component}):[];
  const applicableRevision=directives.length
    ? Math.max(...directives.map((item:any)=>Number(item.revision||0)))
    : sinceRevision;
  return NextResponse.json({
    ...publicState(s),
    applicable_revision:applicableRevision,
    directives,
  },{headers:{'cache-control':'no-store'}});
}

export async function POST(request:Request){
  const body=await request.json().catch(()=>({}));
  const action=String(body?.action||'pulse').trim().toLowerCase();

  if(action==='ack'){
    try{
      const status=String(body?.status||'received').trim().toLowerCase();
      if(!['received','applied','failed'].includes(status))return NextResponse.json({error:'Unsupported receipt status',code:'PULSE_RECEIPT_STATUS_INVALID'},{status:400});
      const result=await acknowledgePulse({
        pulseId:body?.pulse_id??body?.pulseId??null,
        revision:body?.revision??null,
        licenseId:body?.license_id??body?.licenseId??null,
        installationId:String(body?.installation_id??body?.installationId??''),
        product:body?.product??null,
        component:body?.component??null,
        client:body?.client??null,
        clientVersion:body?.client_version??body?.clientVersion??null,
        status:status as 'received'|'applied'|'failed',
        resultCode:body?.result_code??body?.resultCode??null,
        error:body?.error??null,
        resultingLicenseState:body?.resulting_license_state??body?.resultingLicenseState??null,
        resultingRevision:body?.resulting_revision??body?.resultingRevision??null,
        details:body?.details&&typeof body.details==='object'?body.details:{},
      });
      return NextResponse.json(result,{headers:{'cache-control':'no-store'}});
    }catch(error:any){
      return NextResponse.json({error:String(error?.message||'Pulse acknowledgement failed'),code:String(error?.code||'PULSE_ACK_FAILED')},{status:Number(error?.status||500),headers:{'cache-control':'no-store'}});
    }
  }

  const auth=await integrationAuthorized(request,'license.manage');
  if(!auth)return NextResponse.json({error:'Unauthorized'},{status:401});

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
  const pulseAction=String(body?.pulse_action||body?.directive_action||'full_recheck').trim().toLowerCase();
  const scope=String(body?.scope||body?.pulse_scope||'global').trim().toLowerCase();
  const pulse=await sendPulse(
    null,
    `api:${auth.name}`,
    String(body?.reason||`manual-${pulseAction}`),
    {
      source:'api',
      pulse_action:pulseAction,
      pulse_scope:scope,
      license_id:body?.license_id??body?.licenseId??null,
      installation_id:body?.installation_id??body?.installationId??null,
      product:body?.product??null,
      component:body?.component??null,
      requires_ack:body?.requires_ack,
      expires_at:body?.expires_at??body?.expiresAt??null,
      payload:body?.payload&&typeof body.payload==='object'?body.payload:{},
    },
  );
  const row=await getSettings();
  return NextResponse.json({ok:true,action,pulse,...publicState(row)},{headers:{'cache-control':'no-store'}});
}
