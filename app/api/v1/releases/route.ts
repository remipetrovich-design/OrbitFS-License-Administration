import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../lib/auth';
import {db} from '../../../../lib/db';
import {createRelease,listReleases} from '../../../../lib/core/releases';

export async function GET(request:Request){
  const auth=await integrationAuthorized(request,'releases.read');
  if(!auth)return NextResponse.json({error:'UNAUTHORIZED',code:'UNAUTHORIZED'},{status:401});
  const u=new URL(request.url);
  const product=String(u.searchParams.get('product')||'').trim().toLowerCase();
  const channel=String(u.searchParams.get('channel')||'').trim().toLowerCase();
  const type=String(u.searchParams.get('type')||'').trim().toLowerCase();
  const rows=await listReleases(u.searchParams.get('include_archived')==='true');
  const releases=rows.filter((r:any)=>(!product||String(r.product).toLowerCase()===product)&&(!channel||String(r.channel).toLowerCase()===channel)&&(!type||String(r.release_type).toLowerCase()===type));
  return NextResponse.json({releases});
}

export async function POST(request:Request){
  const auth=await integrationAuthorized(request,'releases.write');
  if(!auth)return NextResponse.json({error:'UNAUTHORIZED',code:'UNAUTHORIZED'},{status:401});
  const body=await request.json().catch(()=>null);
  if(!body)return NextResponse.json({error:'INVALID_REQUEST'},{status:400});
  try{
    const productSlug=String(body.product||body.product_code||body.product_id||'').trim().toLowerCase();
    if(!productSlug)return NextResponse.json({error:'PRODUCT_REQUIRED'},{status:400});
    const product=(await db().query("select id from products where slug=$1 or id::text=$1 limit 1",[productSlug])).rows[0];
    if(!product)return NextResponse.json({error:'PRODUCT_NOT_FOUND'},{status:404});
    const releaseType=String(body.release_type||body.releaseType||'update').trim().toLowerCase();
    if(!['base','update'].includes(releaseType))return NextResponse.json({error:'INVALID_RELEASE_TYPE'},{status:400});
    const row=await createRelease({
      productId:product.id,channel:String(body.channel||'stable').trim().toLowerCase(),version:String(body.version||'').trim(),releaseType:releaseType as 'base'|'update',
      sourceRepo:body.source_repo??body.sourceRepo??null,sourceRef:body.source_ref??body.sourceRef??null,sourceSha:body.source_sha??body.sourceCommit??null,
      artifactUrl:body.artifact_url??body.artifactUrl??null,checksum:body.checksum??body.sha256??null,notes:body.changelog??body.notes??null,
      manifest:body.manifest&&typeof body.manifest==='object'?body.manifest:{},actor:`api:${auth.name}`
    });
    return NextResponse.json({ok:true,release:row,release_id:row.id});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to create release',code:'RELEASE_CREATE_FAILED'},{status:400});}
}
