import {NextResponse} from 'next/server';
import {getSettings,getSourceHandoverStatus} from '../../../../lib/core/settings';
import {inspectSourceDeployments} from '../../../../lib/core/source-activation';
import {db} from '../../../../lib/db';

// Vercel Cron runs independently of the owner's browser. Only the active
// License Manager installation may advance its own handover observations.
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:Request){
 const bearer=request.headers.get('authorization')||'';
 const cronSecret=String(process.env.CRON_SECRET||'');
 if(!cronSecret||bearer!=='Bearer '+cronSecret)
  return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
 try{
  const settings=await getSettings();
  const handover=await getSourceHandoverStatus();
  const mode=settings?.github_profile==='fallback'?'fallback':'primary';
  // The Vercel project identity is fixed to this repository's License Manager.
  const profile='fallback';
  if(mode!==profile)return NextResponse.json({ok:true,stage:'standby',mode});
  const destination=await inspectSourceDeployments(mode);
  // Fail closed: no production shutdown or mode mutation on cron. It records
  // objective readiness; authenticated deployment attestations are required
  // before the old mode is retired.
  await db().query(
   `insert into audit_events(actor,action,resource_type,resource_id,details)
    values('cron:source-handover','github_profile.handover_observed','system_settings','github_profile',$1)`,
   [JSON.stringify({mode,revision:handover.revision,stage:handover.stage,
    destination:destination.services,shutdown_allowed:false})]
  );
  return NextResponse.json({ok:true,mode,stage:handover.stage,
   services:destination.services,shutdownAllowed:false},
   {headers:{'cache-control':'no-store'}});
 }catch(error){
  return NextResponse.json({error:'HANDOVER_OBSERVATION_FAILED'},
   {status:503,headers:{'cache-control':'no-store'}});
 }
}
