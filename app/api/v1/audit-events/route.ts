import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../lib/auth';
import {db} from '../../../../lib/db';

export async function GET(request:Request){
  const auth=await integrationAuthorized(request,'releases.read');
  if(!auth)return NextResponse.json({error:'UNAUTHORIZED',code:'UNAUTHORIZED'},{status:401});
  const u=new URL(request.url);
  const limit=Math.min(200,Math.max(1,Number(u.searchParams.get('limit')||50)));
  const rows=(await db().query(
    `select id,actor_user_id,actor,action,resource_type,resource_id,details,created_at from audit_events order by created_at desc limit $1`,[limit])).rows;
  return NextResponse.json({events:rows});
}
