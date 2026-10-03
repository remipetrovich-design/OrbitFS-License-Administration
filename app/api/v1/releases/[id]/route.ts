import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../../lib/auth';
import {db} from '../../../../../lib/db';
import {archiveRelease,publishRelease,promoteRelease,createPresentationRevision,updateReleasePresentation,withdrawRelease,setReleaseReview,markReleaseRolledBack,withAuthoritativeReleaseRuntimeAccess} from '../../../../../lib/core/releases';

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const auth=await integrationAuthorized(request,'releases.read');
  if(!auth)return NextResponse.json({error:'UNAUTHORIZED',code:'UNAUTHORIZED'},{status:401});
  const {id}=await params;
  const row=(await db().query("select r.*,p.slug product,p.name product_name from releases r join products p on p.id=r.product_id where r.id=$1 limit 1",[id])).rows[0];
  if(!row)return NextResponse.json({error:'RELEASE_NOT_FOUND'},{status:404});
  return NextResponse.json({release:withAuthoritativeReleaseRuntimeAccess(row)});
}
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  const auth=await integrationAuthorized(request,'releases.write');
  if(!auth)return NextResponse.json({error:'UNAUTHORIZED',code:'UNAUTHORIZED'},{status:401});
  const {id}=await params; const body=await request.json().catch(()=>({}));
  const current=(await db().query('select release_type from releases where id=$1 limit 1',[id])).rows[0];
  if(!current)return NextResponse.json({error:'RELEASE_NOT_FOUND'},{status:404});
  if(current.release_type!=='update')return NextResponse.json({error:'BASE_RELEASE_CONTROLLED_BY_LICENSE_MANAGER',code:'BASE_RELEASE_CONTROLLED_BY_LICENSE_MANAGER'},{status:403});
  try{const release=await updateReleasePresentation(id,body,undefined,`api:${auth.name}`);if(!release)return NextResponse.json({error:'RELEASE_NOT_FOUND'},{status:404});return NextResponse.json({release});}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to update release',code:'RELEASE_UPDATE_FAILED'},{status:400});}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  const auth=await integrationAuthorized(request,'releases.write');
  if(!auth)return NextResponse.json({error:'UNAUTHORIZED',code:'UNAUTHORIZED'},{status:401});
  const {id}=await params; const body=await request.json().catch(()=>({})); const action=String(body.action||'').trim().toLowerCase();
  const current=(await db().query('select release_type from releases where id=$1 limit 1',[id])).rows[0];
  if(!current)return NextResponse.json({error:'RELEASE_NOT_FOUND'},{status:404});
  if(action==='approve'||action==='reject'||action==='return_to_dev'||action==='send_back'||action==='rollback'||action==='revert'){
    const control=await integrationAuthorized(request,'releases.control');
    if(!control)return NextResponse.json({error:'TECHNICAL_RELEASE_CONTROL_REQUIRES_CONTROL_SCOPE',code:'TECHNICAL_RELEASE_CONTROL_REQUIRES_CONTROL_SCOPE'},{status:403});
    try{
      if(action==='approve')return NextResponse.json({release:await setReleaseReview(id,'approved',undefined,`api:${auth.name}`,body.reason?String(body.reason):undefined)});
      if(action==='reject'||action==='return_to_dev'||action==='send_back')return NextResponse.json({release:await setReleaseReview(id,'rejected',undefined,`api:${auth.name}`,body.reason?String(body.reason):'Returned to Dev/Control Centre for rework')});
      return NextResponse.json({release:await markReleaseRolledBack(id,String(body.reason||''),undefined,`api:${control.name}`,action==='revert'?'revert':'rollback')});
    }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Technical release control failed',code:'TECHNICAL_RELEASE_CONTROL_FAILED'},{status:400});}
  }
  if(action==='delete'){
    try{
      const release=(await db().query('select * from releases where id=$1 limit 1',[id])).rows[0];
      if(!release)return NextResponse.json({error:'RELEASE_NOT_FOUND',code:'RELEASE_NOT_FOUND'},{status:404});
      const everPublished=release.status==='published'||Boolean(release.published_at);
      if(everPublished){
        return NextResponse.json({error:'EVER_PUBLISHED_RELEASE_DELETE_FORBIDDEN',code:'EVER_PUBLISHED_RELEASE_DELETE_FORBIDDEN',status:release.status,message:'Published release history is retained for rollback and audit. Only never-published release attempts can be permanently deleted.'},{status:409});
      }
      const deleted=(await db().query('delete from releases where id=$1 returning *',[id])).rows[0];
      await db().query("insert into audit_events(actor,action,resource_type,resource_id,details) values($1,'release.delete','release',$2,$3)",[`api:${auth.name}`,id,JSON.stringify({product_id:deleted.product_id,version:deleted.version,channel:deleted.channel,release_type:deleted.release_type,status:deleted.status,review_status:deleted.review_status,created_at:deleted.created_at,published_at:null,permanent:true,never_published:true,reason:body.reason?String(body.reason):null})]);
      return NextResponse.json({deleted:true,id,previous_status:deleted.status,never_published:true});
    }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Release delete failed',code:'RELEASE_DELETE_FAILED'},{status:400});}
  }
  if(['withdraw','archive','restore'].includes(action)){
    const control=await integrationAuthorized(request,'releases.control');
    if(control){
      try{
        if(action==='withdraw')return NextResponse.json({release:await withdrawRelease(id,undefined,`api:${control.name}`)});
        if(action==='archive')return NextResponse.json({release:await archiveRelease(id,true,undefined,`api:${control.name}`,body.reason?String(body.reason):undefined)});
        return NextResponse.json({release:await archiveRelease(id,false,undefined,`api:${control.name}`)});
      }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Release lifecycle control failed',code:'RELEASE_LIFECYCLE_CONTROL_FAILED'},{status:400});}
    }
  }
  try{
    // Publication/promotion are customer-facing release lifecycle actions for both
    // Base and Update releases. Technical validation/approval remains protected
    // above by releases.control and is enforced again by publishRelease/promoteRelease.
    if(action==='publish')return NextResponse.json({release:await publishRelease(id,undefined,`api:${auth.name}`)});
    if(action==='withdraw')return NextResponse.json({release:await withdrawRelease(id,undefined,`api:${auth.name}`)});
    if(action==='disable'||action==='pause'){const row=(await db().query("select * from releases where id=$1 limit 1",[id])).rows[0];if(!row)return NextResponse.json({error:'RELEASE_NOT_FOUND'},{status:404});const release=row.status==='published'?await withdrawRelease(id,undefined,`api:${auth.name}`):(await db().query("update releases set status='withdrawn' where id=$1 returning *",[id])).rows[0];if(row.status!=='published')await db().query("insert into audit_events(actor,action,resource_type,resource_id,details) values($1,'release.withdraw','release',$2,$3)",["api:"+auth.name,id,JSON.stringify({previous_status:row.status,reason:'pause'})]);return NextResponse.json({release});}
    if(action==='archive')return NextResponse.json({release:await archiveRelease(id,true,undefined,`api:${auth.name}`,body.reason?String(body.reason):undefined)});
    if(action==='restore')return NextResponse.json({release:await archiveRelease(id,false,undefined,`api:${auth.name}`)});
    if(action==='promote')return NextResponse.json({release:await promoteRelease(id,String(body.target_channel||body.targetChannel||'').trim().toLowerCase(),undefined,`api:${auth.name}`)});
    if(action==='revise')return NextResponse.json({release:await createPresentationRevision(id,body,undefined,`api:${auth.name}`)});
    return NextResponse.json({error:'UNSUPPORTED_RELEASE_ACTION'},{status:400});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Release action failed',code:'RELEASE_ACTION_FAILED'},{status:400});}
}