import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../../lib/auth';
import {db} from '../../../../../lib/db';

export async function POST(request:Request){
  const actor=await integrationAuthorized(request,'deployment.write');
  if(!actor)return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});

  const body=await request.json().catch(()=>({}));
  const action=String(body?.action||'').trim().toLowerCase();
  const installationId=String(body?.installation_id||body?.installationId||'').trim();
  const licenseId=String(body?.license_id||body?.licenseId||'').trim();
  const reason=String(body?.reason||'').trim().slice(0,500)||null;

  if(!['lock','unlock'].includes(action))return NextResponse.json({ok:false,code:'UNSUPPORTED_INSTALLATION_CONTROL'},{status:400});
  if(!installationId)return NextResponse.json({ok:false,code:'INSTALLATION_ID_REQUIRED'},{status:400});
  if(action==='lock'&&!reason)return NextResponse.json({ok:false,code:'INSTALLATION_LOCK_REASON_REQUIRED',error:'A deployment lock reason is required.'},{status:400});

  const params:any[]=[installationId];
  const licenseFilter=licenseId?' and license_id=$2':'';
  if(licenseId)params.push(licenseId);
  const activation=(await db().query(
    `select id,license_id,installation_id,status,metadata
     from activations
     where installation_id=$1${licenseFilter}
     order by last_seen_at desc nulls last,first_seen_at desc
     limit 1`,
    params,
  )).rows[0];

  if(!activation)return NextResponse.json({ok:false,code:'INSTALLATION_NOT_FOUND'},{status:404});

  const locked=action==='lock';
  const changedAt=new Date().toISOString();
  const changedBy=String(actor.actor||actor.name||'billing-deployer');
  const lock={
    locked,
    reason:locked?reason:null,
    changed_at:changedAt,
    changed_by:changedBy,
  };

  const updated=(await db().query(
    `update activations
     set metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{deployment_lock}',$2::jsonb,true)
     where id=$1
     returning id,license_id,installation_id,status,metadata`,
    [activation.id,JSON.stringify(lock)],
  )).rows[0];

  await db().query(
    `insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details)
     values(null,$1,$2,'installation',$3,$4)`,
    [
      changedBy,
      locked?'installation.deployment_locked':'installation.deployment_unlocked',
      activation.id,
      JSON.stringify({installation_id:activation.installation_id,license_id:activation.license_id,reason,locked}),
    ],
  );

  return NextResponse.json({
    ok:true,
    authority:'orbitfs-license-master-v2',
    action,
    installation:{
      id:updated.id,
      license_id:updated.license_id,
      installation_id:updated.installation_id,
      status:updated.status,
      deployment_locked:locked,
      deployment_lock_reason:locked?reason:null,
      deployment_lock_changed_at:changedAt,
      deployment_lock_changed_by:changedBy,
    },
  },{headers:{'cache-control':'no-store'}});
}
