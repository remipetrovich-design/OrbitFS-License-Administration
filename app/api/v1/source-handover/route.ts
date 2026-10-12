import {NextResponse} from 'next/server';
import {requireUser} from '../../../../lib/session';
import {getSourceHandoverStatus} from '../../../../lib/core/settings';
export const dynamic='force-dynamic';
export async function GET(){
 try{
  const user=await requireUser();
  if(!['owner','admin'].includes(user.role))
   return NextResponse.json({error:'FORBIDDEN'},{status:403});
  return NextResponse.json(await getSourceHandoverStatus(),
   {headers:{'cache-control':'no-store'}});
 }catch{
  return NextResponse.json({error:'HANDOVER_STATUS_UNAVAILABLE'},
   {status:503,headers:{'cache-control':'no-store'}});
 }
}
