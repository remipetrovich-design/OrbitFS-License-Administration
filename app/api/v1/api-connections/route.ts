import {NextRequest,NextResponse} from 'next/server';
import {getOfficialApiRegistry} from '../../../../lib/core/api-connections';

export const dynamic='force-dynamic';

export async function GET(request:NextRequest){
 try{
  const client=String(request.nextUrl.searchParams.get('client')||'').trim().toLowerCase()||null;
  const service=String(request.nextUrl.searchParams.get('service')||'').trim().toLowerCase()||null;
  const registry=await getOfficialApiRegistry({client,service});
  return NextResponse.json(registry,{headers:{'cache-control':'no-store'}});
 }catch(error:any){
  return NextResponse.json({error:String(error?.message||'Unable to load official OrbitFS API registry')},{status:500,headers:{'cache-control':'no-store'}});
 }
}
