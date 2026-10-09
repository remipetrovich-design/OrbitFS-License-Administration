import {NextResponse} from 'next/server';
import {getGithubProfile} from '../../../../lib/core/settings';
import {configuredVercelFamily} from '../../../../lib/core/source-vercel';

export const dynamic='force-dynamic';

// This API is the one public routing authority. It never changes the selected
// profile, deploys a service, or exposes account credentials.
const PRIMARY_DESTINATIONS={
  panel:{projectId:'prj_o5ju4zFGSDZelX4SA7GAu3rQqtap',url:'https://dev.incendiarynetworks.cc'},
  billing:{projectId:'prj_3ARdg4cRikU2OiMeZjZDvQ3JuEZd',url:'https://orbitfsstore.vercel.app'},
} as const;
const FALLBACK_DESTINATIONS={
  panel:{projectId:'prj_24FvbyWw7CAEbiug1Ec18p51z7WJ',url:'https://orbitfs-dev-panel-fallback.vercel.app'},
  billing:{projectId:'prj_BZNKPOm5pTcMdD4QrOXPOqpE7Imq',url:'https://orbitfs-billing-fallback.vercel.app'},
} as const;

type Readiness={panel:boolean;billing:boolean};
let healthCache:Partial<Record<'primary'|'fallback',{until:number;promise:Promise<Readiness>}>>={};

async function isReady(projectId:string,token:string,teamId:string):Promise<boolean>{
  if(!token||/^(change-me|replace-with|placeholder|your-)/i.test(token))return false;
  try{
    const url=new URL('https://api.vercel.com/v6/deployments');
    url.searchParams.set('projectId',projectId);
    url.searchParams.set('teamId',teamId);
    url.searchParams.set('target','production');
    url.searchParams.set('state','READY');
    url.searchParams.set('limit','1');
    const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(4000),
      headers:{authorization:'Bearer '+token,accept:'application/json'}});
    if(!response.ok)return false;
    const result=await response.json() as {deployments?:Array<{readyState?:string;state?:string;target?:string}>};
    // The Vercel state+target query already scopes this list. Vercel may
    // omit target from individual response items; use the READY state only.
    return Array.isArray(result.deployments)&&result.deployments.some(d=>
      d.readyState==='READY'||d.state==='READY'
    );
  }catch{return false;}
}

async function reachableProductionPage(url:string):Promise<boolean>{
  try{
    // READY in Vercel is not sufficient if the application responds with
    // server errors or Vercel Authentication. Probe the fixed public URL too.
    const response=await fetch(url,{
      method:'GET',cache:'no-store',redirect:'manual',
      signal:AbortSignal.timeout(6500),headers:{accept:'text/html'}
    });
    // Login redirects are allowed; Vercel login protection (401/403)
    // and application errors cannot receive user traffic.
    return (response.status>=200&&response.status<300) ||
      [301,302,303,307,308].includes(response.status);
  }catch{return false;}
}

function familyReadiness(profile:'primary'|'fallback'){
  const cached=healthCache[profile];
  if(cached&&cached.until>Date.now())return cached.promise;
  const family=configuredVercelFamily(profile);
  const destinations=profile==='fallback'?FALLBACK_DESTINATIONS:PRIMARY_DESTINATIONS;
  const token=String(process.env[family.tokenEnv]||'').trim();
  const promise=Promise.all([
    isReady(destinations.panel.projectId,token,family.teamId),
    isReady(destinations.billing.projectId,token,family.teamId),
  ]).then(async([panel,billing])=>{
    const [panelLive,billingLive]=await Promise.all([
      panel?reachableProductionPage(destinations.panel.url):Promise.resolve(false),
      billing?reachableProductionPage(destinations.billing.url):Promise.resolve(false),
    ]);
    return {panel:panel&&panelLive,billing:billing&&billingLive};
  });
  healthCache[profile]={until:Date.now()+12000,promise};
  return promise;
}

export async function GET(){
 try{
  const profile=await getGithubProfile();
  // MAIN is the permanent entrypoint: it never requires a cross-account
  // redirect. Do not mark routing incomplete because of an unnecessary
  // self-probe from a Vercel function back into its own main domain.
  const ready=profile==='primary'?{panel:true,billing:true}:await familyReadiness(profile);
  const destinations=profile==='fallback'?FALLBACK_DESTINATIONS:PRIMARY_DESTINATIONS;
  return NextResponse.json({
    profile,
    mode:profile==='fallback'?'fallback':'main',
    ready,
    targets:{
      panel:destinations.panel.url,
      billing:destinations.billing.url,
    },
    routingComplete:ready.panel&&ready.billing,
    authority:'License Manager',
  },{headers:{'cache-control':'no-store, no-cache, must-revalidate'}});
 }catch{
  // An unreachable authority must never make a browser follow a guessed
  // destination. Clients should preserve the existing accessible page.
  return NextResponse.json({error:'Source routing temporarily unavailable'},{
    status:503,headers:{'cache-control':'no-store'}
  });
 }
}
