import {NextResponse} from 'next/server';
import {disableEmergencyLockdown,getEmergencyLockdown} from '../../../../../lib/core/lockdown';

function recoveryAuthorized(request:Request){
 const expected=String(process.env.AUTHORITY_LOCKDOWN_RECOVERY_TOKEN||'').trim();
 if(!expected)return false;
 const authorization=String(request.headers.get('authorization')||'');
 return authorization===`Bearer ${expected}`;
}

export async function GET(request:Request){
 if(!recoveryAuthorized(request))return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});
 return NextResponse.json({ok:true,...await getEmergencyLockdown()},{headers:{'cache-control':'no-store'}});
}

export async function POST(request:Request){
 if(!recoveryAuthorized(request))return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});
 const body=await request.json().catch(()=>({}));
 if(String(body?.confirm||'')!=='UNLOCK')return NextResponse.json({ok:false,code:'UNLOCK_CONFIRMATION_REQUIRED'},{status:409});
 try{
  const state=await disableEmergencyLockdown('authority-recovery',String(body?.reason||'Owner recovery'));
  return NextResponse.json({ok:true,code:'AUTHORITY_AVAILABLE',...state});
 }catch(error){return NextResponse.json({ok:false,code:'UNLOCK_FAILED',error:error instanceof Error?error.message:'Unlock failed'},{status:500})}
}
