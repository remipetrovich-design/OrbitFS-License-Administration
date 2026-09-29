import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../../lib/auth';
import {db} from '../../../../../lib/db';
import {setInstallationStatus} from '../../../../../lib/core/licenses';

const ACTIONS=new Set(['undeploy','uninstall']);
const PHASES=new Set(['plan','authorize','completed','failed']);

export async function POST(request:Request){
  const actor=await integrationAuthorized(request,'deployment.write');
  if(!actor)return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});
  const body=await request.json().catch(()=>null);
  const action=String(body?.action||'').trim().toLowerCase();
  const phase=String(body?.phase||'plan').trim().toLowerCase();
  const licenseId=String(body?.licenseId||body?.license_id||'').trim();
  const installationId=String(body?.installationId||body?.installation_id||'').trim();
  const releaseLicense=body?.releaseLicense===true||body?.release_license===true;
  if(!ACTIONS.has(action))return NextResponse.json({ok:false,code:'UNSUPPORTED_LIFECYCLE_ACTION'},{status:400});
  if(!PHASES.has(phase))return NextResponse.json({ok:false,code:'INVALID_LIFECYCLE_PHASE'},{status:400});
  if(!licenseId||!installationId)return NextResponse.json({ok:false,code:'LICENSE_AND_INSTALLATION_REQUIRED'},{status:400});
  const license=(await db().query('select id,status from licenses where id=$1 limit 1',[licenseId])).rows[0];
  if(!license)return NextResponse.json({ok:false,code:'LICENSE_NOT_FOUND'},{status:404});
  const activation=(await db().query('select id,status,installation_id from activations where license_id=$1 and installation_id=$2 limit 1',[licenseId,installationId])).rows[0]||null;
  if(phase==='completed'&&action==='uninstall'&&releaseLicense&&activation&&activation.status!=='released'){
    await setInstallationStatus(activation.id,'released',null,'orbitfs-lifecycle');
  }
  await db().query(`insert into audit_events(actor,action,resource_type,resource_id,details) values($1,$2,'installation',$3,$4)`,[`api:${actor.name||'deployer'}`,`installation.lifecycle.${action}.${phase}`,activation?.id||licenseId,JSON.stringify({action,phase,licenseId,installationId,releaseLicense})]);
  return NextResponse.json({ok:true,authority:'orbitfs-license-master-v2',action,phase,authorized:phase==='authorize'||phase==='plan',releaseLicense});
}
