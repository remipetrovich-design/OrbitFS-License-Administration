import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../lib/auth';
import {db} from '../../../../lib/db';

export async function GET(request:Request){
  const auth=await integrationAuthorized(request,'releases.read');
  if(!auth)return NextResponse.json({error:'UNAUTHORIZED',code:'UNAUTHORIZED'},{status:401});
  const rows=(await db().query("select id,slug,name,description,status,validation_policy,created_at,updated_at from products order by name")).rows;
  return NextResponse.json({products:rows});
}