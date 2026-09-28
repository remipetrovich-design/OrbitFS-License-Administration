import { redirect } from 'next/navigation';
import { db } from '../../lib/db';
import { createSession, getSessionUser, hashPassword } from '../../lib/session';

export const dynamic = 'force-dynamic';

async function setup(formData: FormData) {
  'use server';
  const existing = await db().query('select count(*)::int count from users');
  if (existing.rows[0].count > 0) redirect('/login');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const name = String(formData.get('name') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !name || password.length < 12) throw new Error('Use a name, valid email and password of at least 12 characters.');
  const { hash, salt } = hashPassword(password);
  const result = await db().query(`insert into users(email,password_hash,password_salt,display_name,role) values($1,$2,$3,$4,'owner') returning id`, [email,hash,salt,name]);
  await db().query(`insert into audit_events(actor,action,resource_type,resource_id,details) values('system','user.bootstrap','user',$1,$2)`, [result.rows[0].id, JSON.stringify({ email })]);
  await createSession(result.rows[0].id);
  redirect('/');
}

export default async function SetupPage() {
 if (await getSessionUser()) redirect('/');
 const count=(await db().query('select count(*)::int count from users')).rows[0].count;
 if(count>0)redirect('/login');
 return <main className="auth-shell">
  <section className="auth-form-panel">
   <div className="auth-form-card">
    <div className="eyebrow">Owner bootstrap</div><h2>Create first Owner</h2>
    <form className="form" action={setup}><label>Name<input className="input" name="name" required autoComplete="name"/></label><label>Email<input className="input" name="email" type="email" required autoComplete="email"/></label><label>Password<input className="input" name="password" type="password" minLength={12} required autoComplete="new-password"/></label><button className="button" type="submit">Create Owner account</button></form>
   </div>
  </section>
 </main>;
}
