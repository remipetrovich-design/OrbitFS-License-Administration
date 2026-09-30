import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../lib/auth';
import {db} from '../../../../lib/db';

export async function GET(request:Request){
  const auth=await integrationAuthorized(request,'releases.read');
  if(!auth)return NextResponse.json({error:'UNAUTHORIZED',code:'UNAUTHORIZED'},{status:401});
  const u=new URL(request.url);
  const limit=Math.min(200,Math.max(1,Number(u.searchParams.get('limit')||50)));
  const resourceType=String(u.searchParams.get('resource_type')||'').trim();
  const action=String(u.searchParams.get('action')||'').trim();
  const params:any[]=[]; const where:string[]=[];
  if(resourceType){params.push(resourceType);where.push(`resource_type=$${params.length}`);}
  if(action){params.push(action);where.push(`action=$${params.length}`);}
  params.push(limit);
  const rows=(await db().query(
    `select id,actor_user_id,actor,action,resource_type,resource_id,details,created_at
     from audit_events
     ${where.length?`where ${where.join(' and ')}`:''}
     order by created_at desc
     limit $${params.length}`,params)).rows;
  return NextResponse.json({events:rows});
}
