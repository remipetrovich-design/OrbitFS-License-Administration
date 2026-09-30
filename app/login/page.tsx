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
  <section className="auth-brand-panel">
   <div className="auth-brand-mark">LM</div>
   <div><div className="eyebrow">OrbitFS authority</div><h1>License Manager</h1><p>Technical control plane for licensing, release validation, entitlement and deployment authorization.</p></div>
   <div className="auth-status-list">
    <div><span className="status-light online"/><div><strong>Licence authority</strong><small>Runtime validation and entitlement state</small></div></div>
    <div><span className="status-light online"/><div><strong>Release authority</strong><small>Intake, validation and technical approval</small></div></div>
    <div><span className="status-light online"/><div><strong>Deployment authority</strong><small>Authorization and coordination only</small></div></div>
   </div>
  </section>
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
