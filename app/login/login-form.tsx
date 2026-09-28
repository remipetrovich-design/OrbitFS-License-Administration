'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginForm(){
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const router=useRouter();
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});if(r.ok){router.replace('/');router.refresh();}else{const j=await r.json().catch(()=>({}));setError(j.error||'Sign in failed');setBusy(false);}}
  return <form className="form" onSubmit={submit}><label>Email<input className="input" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input className="input" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>{error&&<div className="notice danger-text">{error}</div>}<button className="button" disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form>;
}
