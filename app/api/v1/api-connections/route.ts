import {NextRequest,NextResponse} from 'next/server';
import {getOfficialApiRegistry} from '../../../../lib/core/api-connections';
import {getGithubProfile} from '../../../../lib/core/settings';

export const dynamic='force-dynamic';

export async function GET(request:NextRequest){
 try{
  const client=String(request.nextUrl.searchParams.get('client')||'').trim().toLowerCase()||null;
  const service=String(request.nextUrl.searchParams.get('service')||'').trim().toLowerCase()||null;
  const registry=await getOfficialApiRegistry({client,service});
  // The authority registry is shared across Main and Fallback. Keep its stored
  // records unchanged, but publish the selected source's actual service origin.
  // This prevents Fallback clients from being sent to Main's API during failover.
  const profile=await getGithubProfile();
  if(profile==='fallback'){
   const configured=String(process.env.ORBITFS_FALLBACK_LICENSE_MASTER_URL||'').trim();
   const url=new URL(configured);
   if(url.protocol!=='https:'||url.hostname!=='lm.incendiarynetworks.cc'||url.pathname!=='/api/v1'||url.username||url.password||url.search||url.hash){
    throw new Error('ORBITFS_FALLBACK_LICENSE_MASTER_URL must target the verified Fallback License Manager API');
   }
   const base=url.origin+'/api/v1';
   registry.connections=registry.connections.map((row:any)=>({
    ...row,
    base_url:row.service_key==='license_manager'?base:row.service_key==='license_runtime'?base+'/license':row.base_url
   }));
  }
  return NextResponse.json(registry,{headers:{'cache-control':'no-store'}});
 }catch(error:any){
  return NextResponse.json({error:String(error?.message||'Unable to load official OrbitFS API registry')},{status:500,headers:{'cache-control':'no-store'}});
 }
}
