import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'License Manager', description: 'Independent licensing, authority, deployment and release control plane' };

type GithubProfileStatus={
  profile:'primary'|'fallback'|'unknown';
  label:string;
  repository:string;
};

async function githubProfileStatus():Promise<GithubProfileStatus>{
  try{
    const response=await fetch('https://dev.incendiarynetworks.cc/api/github-profile',{cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('Profile endpoint unavailable');
    const body=await response.json();
    if(body?.profile==='fallback')return {profile:'fallback',label:'Remi fallback',repository:'remipetrovich-design/OrbitFS-License-Administration'};
    if(body?.profile==='primary')return {profile:'primary',label:'Primary',repository:'lucaskerim123/Custom-licence-manager'};
  }catch{}
  return {profile:'unknown',label:'Profile unavailable',repository:'Unable to verify active GitHub source'};
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const source=await githubProfileStatus();
  return <html lang="en"><body>
    <div className={'runtime-source-badge '+('runtime-source-'+source.profile)} role="status" aria-label="Active GitHub system">
      <span>Active GitHub system</span>
      <strong>{source.label}</strong>
      <small>{source.repository}</small>
      <small>License Manager UI + /api/v1</small>
    </div>
    {children}
  </body></html>;
}
