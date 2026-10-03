import { NextRequest, NextResponse } from 'next/server';
import { adminAuthorized } from '../../../../lib/auth';
import {getSettings,setSetting,updateRuntimePolicy} from '../../../../lib/core/settings';

export async function GET(request: NextRequest) {
  if (!adminAuthorized(request)) return NextResponse.json({ error:'Unauthorized' }, { status:401 });
  return NextResponse.json(await getSettings(),{headers:{'cache-control':'no-store'}});
}

export async function PATCH(request: NextRequest) {
  if (!adminAuthorized(request)) return NextResponse.json({ error:'Unauthorized' }, { status:401 });
  const body=await request.json().catch(()=>({}));
  const actor='admin-api';
  for(const field of ['system_enabled','licensing_enabled','maintenance_mode','customer_self_unlock_enabled','release_system_enabled','auto_technical_approval_enabled','deployment_enabled','base_deployment_enabled','update_deployment_enabled','rollback_enabled'] as const){
    if(typeof body[field]==='boolean')await setSetting(field,body[field],null,actor);
  }
  if(['validation_ttl_seconds','offline_grace_seconds','pulse_poll_seconds','max_failed_validations','allow_offline_grace'].some(k=>body[k]!==undefined)){
    await updateRuntimePolicy(body,null,actor);
  }
  return NextResponse.json(await getSettings(),{headers:{'cache-control':'no-store'}});
}
