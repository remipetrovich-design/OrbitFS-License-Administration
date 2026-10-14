import {NextResponse} from 'next/server';
import {getSettings} from '../../../../lib/core/settings';

export const dynamic='force-dynamic';

// Both deployments read the shared authoritative mode. This contract contains
// public connection identities only: never tokens, secrets or customer targets.
const TARGETS={
 main:{
  profile:'primary',
  githubOwner:'lucaskerim123',
  licenseApi:'https://incendiarynetworks.cc/api/v1',
  panel:'https://dev.incendiarynetworks.cc',
  billing:'https://orbitfsstore.vercel.app',
  base:{repo:'lucaskerim123/V1-vercel-base',ref:'base-release'},
  engine:{repo:'lucaskerim123/V1-vercel-engine',ref:'UPDATE_RELEASE'},
 },
 fallback:{
  profile:'fallback',
  githubOwner:'remipetrovich-design',
  licenseApi:'https://lm.incendiarynetworks.cc/api/v1',
  panel:'https://dev1.incendiarynetworks.cc',
  billing:'https://orbitfs-billing-fallback.vercel.app',
  base:{repo:'remipetrovich-design/OrbitFS-Base-System',ref:'base-release'},
  engine:{repo:'remipetrovich-design/OrbitFS_Engine',ref:'UPDATE_RELEASE'},
 }
} as const;

export async function GET(){
 try{
  const settings=await getSettings();
  const mode=settings?.github_profile==='fallback'?'fallback':'main';
  return NextResponse.json({
   protocol:1,mode,revision:Number(settings?.pulse_revision||0),
   switchedAt:settings?.updated_at??null,
   authorityOnline:Boolean(settings?.system_enabled),
   handoverMode:Boolean(settings?.maintenance_mode),
   active:TARGETS[mode],
   shared:{database:true,aiRepair:true},
  },{headers:{'cache-control':'no-store'}});
 }catch{
  return NextResponse.json({error:'SOURCE_CONFIGURATION_UNAVAILABLE'},
   {status:503,headers:{'cache-control':'no-store'}});
 }
}
