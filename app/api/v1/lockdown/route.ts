import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../lib/auth';
import {enableEmergencyLockdown,getEmergencyLockdown} from '../../../../lib/core/lockdown';

export async function GET(request:Request){
 const actor=await integrationAuthorized(request,'license.manage');
 if(!actor)return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});
 return NextResponse.json({ok:true,...await getEmergencyLockdown()},{headers:{'cache-control':'no-store'}});
}

export async function POST(request:Request){
 const actor=await integrationAuthorized(request,'license.manage');
 if(!actor)return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});
 const body=await request.json().catch(()=>({}));
 if(String(body?.confirm||'')!=='LOCKDOWN')return NextResponse.json({ok:false,code:'LOCKDOWN_CONFIRMATION_REQUIRED'},{status:409});
 const reason=String(body?.reason||'').trim();
 if(!reason)return NextResponse.json({ok:false,code:'LOCKDOWN_REASON_REQUIRED'},{status:400});
 try{
  const state=await enableEmergencyLockdown('api:'+String(actor.name||'integration'),reason,body?.message?String(body.message):null);
  return NextResponse.json({ok:true,code:'AUTHORITY_LOCKDOWN',...state});
 }catch(error){return NextResponse.json({ok:false,code:'LOCKDOWN_FAILED',error:error instanceof Error?error.message:'Lockdown failed'},{status:500})}
}
