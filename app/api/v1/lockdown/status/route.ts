import {NextResponse} from 'next/server';
import {getEmergencyLockdown} from '../../../../../lib/core/lockdown';

export const dynamic='force-dynamic';

export async function GET(){
 try{
  const state=await getEmergencyLockdown();
  return NextResponse.json({
   ok:true,
   service:'license-manager',
   code:state.locked?'AUTHORITY_LOCKDOWN':'AUTHORITY_AVAILABLE',
   locked:state.locked,
   message:state.locked?state.message:null,
   locked_at:state.lockedAt,
  },{headers:{'cache-control':'no-store'}});
 }catch{
  return NextResponse.json({ok:false,code:'LOCKDOWN_STATE_UNAVAILABLE',locked:true},{status:503,headers:{'cache-control':'no-store'}});
 }
}
