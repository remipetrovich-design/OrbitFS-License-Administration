import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from './db';

const COOKIE = 'lm_session';
const DAYS = 7;

function hashToken(token: string) { return crypto.createHash('sha256').update(token).digest('hex'); }

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db().query(`insert into user_sessions(user_id, token_hash, expires_at) values($1,$2,now()+interval '7 days')`, [userId, hashToken(token)]);
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: DAYS * 86400 });
}

export async function getSessionUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const result = await db().query(`select u.id,u.email,u.display_name,u.role from user_sessions s join users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now() and u.status='active'`, [hashToken(token)]);
  return result.rows[0] ?? null;
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

export async function destroySession() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (token) await db().query('delete from user_sessions where token_hash=$1', [hashToken(token)]);
  (await cookies()).delete(COOKIE);
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string) {
  const derived = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(derived, Buffer.from(hash, 'hex'));
}
