import './globals.css';
import type { Metadata } from 'next';
import {getGithubProfile} from '../lib/core/settings';

export const dynamic='force-dynamic';
export const metadata: Metadata = { title: 'License Manager', description: 'Independent licensing, authority, deployment and release control plane' };

type GithubProfileStatus={
  profile:'fallback'|'unknown';
  label:string;
  repository:string;
};

const LOCAL_PROFILE='fallback' as const;
const LOCAL_LABEL='Remi fallback';
const LOCAL_REPOSITORY='remipetrovich-design/OrbitFS-License-Administration';

async function githubProfileStatus():Promise<GithubProfileStatus>{
  try{
    const active=await getGithubProfile();
    if(active===LOCAL_PROFILE)return {profile:LOCAL_PROFILE,label:LOCAL_LABEL+' active',repository:LOCAL_REPOSITORY};
    return {profile:LOCAL_PROFILE,label:LOCAL_LABEL+' inactive',repository:LOCAL_REPOSITORY};
  }catch{}
  return {profile:'unknown',label:LOCAL_LABEL+' · profile unavailable',repository:LOCAL_REPOSITORY};
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const source=await githubProfileStatus();
  return <html lang="en"><body>
    <div className={'runtime-source-badge '+('runtime-source-'+source.profile)} role="status" aria-label="GitHub system">
      <span>GitHub system</span>
      <strong>{source.label}</strong>
      <small>{source.repository}</small>
      <small>License Manager UI + /api/v1</small>
    </div>
    {children}
  </body></html>;
}
