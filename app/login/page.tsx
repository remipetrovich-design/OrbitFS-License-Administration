import { redirect } from 'next/navigation';
import { db } from '../../lib/db';
import { getSessionUser } from '../../lib/session';
import LoginForm from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
 if (await getSessionUser()) redirect('/');
 const count=(await db().query('select count(*)::int count from users')).rows[0].count;
 if(count===0)redirect('/setup');
 return <main className="auth-shell">
  <section className="auth-form-panel">
   <div className="auth-form-card">
    <div className="eyebrow">Administrative access</div>
    <h2>Sign in</h2>
    <p className="muted">Use a License Manager control-plane account.</p>
    <LoginForm/>
   </div>
  </section>
 </main>;
}
