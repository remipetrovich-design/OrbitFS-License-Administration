import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../../../lib/auth';
import {validateRelease} from '../../../../../../lib/core/releases';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  const auth=await integrationAuthorized(request,'releases.write'); if(!auth)return NextResponse.json({error:'UNAUTHORIZED',code:'UNAUTHORIZED'},{status:401});
  const {id}=await params; try{const release=await validateRelease(id,undefined,`api:${auth.name}`);if(!release)return NextResponse.json({error:'RELEASE_NOT_FOUND'},{status:404});const validation=release.manifest?.validation||{status:'failed',checks:[]};return NextResponse.json({ok:validation.status==='passed',release,validation},{status:validation.status==='passed'?200:422});}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to validate release',code:'RELEASE_VALIDATION_FAILED'},{status:400});}
}