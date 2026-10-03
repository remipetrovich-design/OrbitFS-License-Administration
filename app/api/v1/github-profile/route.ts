import {NextResponse} from 'next/server';
import {getGithubProfile,getSettings} from '../../../../lib/core/settings';

export const dynamic='force-dynamic';

export async function GET(){
 try{
  const [profile,settings]=await Promise.all([getGithubProfile(),getSettings()]);
  return NextResponse.json({
   profile,
   mode:profile==='primary'?'main':'fallback',
   masterAuthorityOnline:Boolean(settings?.system_enabled),
   updatedAt:settings?.updated_at??null,
  },{headers:{'cache-control':'no-store, no-cache, must-revalidate'}});
 }catch(error){
  return NextResponse.json({error:error instanceof Error?error.message:'Unable to resolve source mode'},{status:500,headers:{'cache-control':'no-store'}});
 }
}
