import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { createSession, verifyPassword } from '../../../../lib/session';

export async function POST(request: Request) {
  const body = await request.json().catch(()=>null);
  const email = String(body?.email||'').trim().toLowerCase();
  const password = String(body?.password||'');
  if(!email || !password) return NextResponse.json({error:'Email and password are required'},{status:400});
  const result=await db().query('select id,password_hash,password_salt,status from users where lower(email)=lower($1) limit 1',[email]);
  const user=result.rows[0];
  if(!user || user.status!=='active' || !verifyPassword(password,user.password_hash,user.password_salt)) return NextResponse.json({error:'Invalid credentials'},{status:401});
  await db().query('update users set last_login_at=now() where id=$1',[user.id]);
  await createSession(user.id);
  return NextResponse.json({ok:true});
}
