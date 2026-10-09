import {db} from '../db';
import type {SourceFamily} from './source-vercel';
import {configuredVercelFamily,verifyVercelAccountProjects} from './source-vercel';

type Service = {repo:string;workflow:string;projectId:string};
const WORKFLOWS:Record<SourceFamily,Service[]>={
 primary:[
  {repo:'lucaskerim123/Custom-licence-manager',workflow:'quick-deploy.yml',projectId:'prj_rxRaSrRX2xwnmJ21zfjYL31RkLsv'},
  {repo:'lucaskerim123/Dev-panel',workflow:'deploy-dev-panel.yml',projectId:'prj_o5ju4zFGSDZelX4SA7GAu3rQqtap'},
  {repo:'lucaskerim123/V2_Billing_Store',workflow:'quick-redesign-deploy.yml',projectId:'prj_3ARdg4cRikU2OiMeZjZDvQ3JuEZd'},
 ],
 fallback:[
  {repo:'remipetrovich-design/OrbitFS-License-Administration',workflow:'quick-deploy.yml',projectId:'prj_rCooJWY8JMkBjekXLO8scT35UPJ8'},
  {repo:'remipetrovich-design/OrbitFS-Control-Centre',workflow:'deploy-dev-panel.yml',projectId:'prj_24FvbyWw7CAEbiug1Ec18p51z7WJ'},
  {repo:'remipetrovich-design/OrbitFS-Billing-Shopfront',workflow:'quick-redesign-deploy.yml',projectId:'prj_BZNKPOm5pTcMdD4QrOXPOqpE7Imq'},
 ]
};

function credentials(profile:SourceFamily){
 const github=String(process.env[profile==='primary'?'ORBITFS_PRIMARY_GITHUB_TOKEN':'ORBITFS_FALLBACK_GITHUB_TOKEN']||
  (profile==='primary'?process.env.ORBITFS_RELEASE_DISPATCH_TOKEN:'')||'').trim();
 const vercel=String(process.env[configuredVercelFamily(profile).tokenEnv]||'').trim();
 if(!github||!vercel||/^(change-me|replace-with|placeholder|your-)/i.test(github)||/^(change-me|replace-with|placeholder|your-)/i.test(vercel))
  throw new Error('The active account GitHub/Vercel connection tokens are missing. Set the matching ORBITFS account tokens in License Manager Production.');
 return {github,vercel,teamId:configuredVercelFamily(profile).teamId};
}

/**
 * Replicate only selected account-switch credentials to the standby
 * License Manager Vercel Production project. Credentials are never
 * persisted to Git or the License Manager database.
 */
export async function syncLicenseManagerAccountConnections(profile:SourceFamily){
 const {vercel,teamId,github:accountGitHub}=credentials(profile);
 const service=WORKFLOWS[profile][0];
 const names=['ORBITFS_MAIN_VERCEL_TOKEN','ORBITFS_FALLBACK_VERCEL_TOKEN',
  'ORBITFS_FALLBACK_GITHUB_TOKEN','ORBITFS_RELEASE_DISPATCH_TOKEN','ORBITFS_PRIMARY_GITHUB_TOKEN'];
 const updated:string[]=[];
 for(const key of names){
  // Release workflow dispatch belongs to the selected GitHub account.
  // Never copy the Main GitHub release credential into Fallback.
  const value=key==='ORBITFS_RELEASE_DISPATCH_TOKEN'?accountGitHub:String(process.env[key]||'').trim();
  if(!value||/^(change-me|replace-with|placeholder|your-)/i.test(value))continue;
  let response:Response;
  try{
   response=await fetch('https://api.vercel.com/v10/projects/'+encodeURIComponent(service.projectId)+
    '/env?upsert=true&teamId='+encodeURIComponent(teamId),{
    method:'POST',cache:'no-store',signal:AbortSignal.timeout(12000),
    headers:{authorization:'Bearer '+vercel,accept:'application/json','content-type':'application/json'},
    body:JSON.stringify({key,value,target:['production'],type:'sensitive',
      comment:'Managed by authoritative License Manager source switch'})
   });
  }catch{throw new Error('Vercel account connection sync failed for '+service.repo);}
  if(!response.ok)throw new Error('Vercel rejected a required account connection for '+service.repo+
   ' (HTTP '+response.status+'). Check selected Vercel account access.');
  updated.push(key);
 }
 return updated;
}

async function github(path:string,token:string,method='GET',payload?:Record<string,string>){
 let response:Response;
 try{response=await fetch('https://api.github.com'+path,{
   method,cache:'no-store',signal:AbortSignal.timeout(12000),
   headers:{accept:'application/vnd.github+json',authorization:'Bearer '+token,
    'x-github-api-version':'2022-11-28','content-type':'application/json'},
   ...(payload?{body:JSON.stringify(payload)}:{})
 });}catch{throw new Error('GitHub connection failed during Production credential synchronization.');}
 if(!response.ok)throw new Error('GitHub '+method+' '+(response.status)+
   ': unable to configure or dispatch the selected repository. Verify that the account token has Actions secrets and Actions workflow write permissions.');
 if(response.status===204)return {};
 try{return await response.json();}catch{throw new Error('GitHub returned an invalid response.');}
}

/**
 * Provisions the correct Vercel account token as the GitHub production environment
 * secret, encrypted with GitHub's public key. No plaintext secrets enter logs,
 * repository commits, browser responses, or the runtime database.
 */
export async function syncSourceGitHubCredentials(profile:SourceFamily){
 const {github:githubToken,vercel}=credentials(profile);
 // Loaded only on the License Manager server. The trusted sodium implementation
 // seals the value to the GitHub environment's public key.
 const sodium=require('libsodium-wrappers');
 await sodium.ready;
 const updated:string[]=[];
 for(const service of WORKFLOWS[profile]){
  const repo=service.repo.split('/').map(encodeURIComponent).join('/');
  const base='/repos/'+repo+'/environments/production';
  const env=await github(base,githubToken) as {name?:string};
  if(env.name?.toLowerCase()!=='production')throw new Error('Missing existing GitHub production environment: '+service.repo);
  const key=await github(base+'/secrets/public-key',githubToken) as {key?:string;key_id?:string};
  if(!key.key||!key.key_id)throw new Error('GitHub did not expose a production secret public key for '+service.repo);
  const publicKey=sodium.from_base64(key.key,sodium.base64_variants.ORIGINAL);
  if(publicKey.length!==32)throw new Error('Invalid GitHub production secret public key');
  const sealed=sodium.to_base64(sodium.crypto_box_seal(sodium.from_string(vercel),publicKey),sodium.base64_variants.ORIGINAL);
  await github(base+'/secrets/VERCEL_TOKEN',githubToken,'PUT',{encrypted_value:sealed,key_id:key.key_id});
  updated.push(service.repo);
 }
 return updated;
}

/** Repair the standby GitHub Actions environment while MAIN is selected.
 * This is an explicit owner action, not a public GET and not a source switch.
 * The Fallback Vercel token is sealed in GitHub before any future handoff.
 */
export async function prepareFallbackGithubProduction(actorUserId:string|null,actor:string){
 const state=(await db().query('select system_enabled,github_profile from system_settings where id=true')).rows[0];
 if(Boolean(state?.system_enabled))throw new Error('Turn Master Authority OFF before preparing Fallback Production connections.');
 if(String(state?.github_profile)!=='primary')
  throw new Error('MAIN must be active to prepare Fallback without switching. Refresh the page.');

 const {github:token}=credentials('fallback');
 // Verify token ownership before touching any repository secrets.
 const identity=await github('/user',token) as {login?:string};
 if(String(identity.login||'').toLowerCase()!=='remipetrovich-design')
  throw new Error('Fallback GitHub credential is not authenticated as remipetrovich-design.');
 await verifyVercelAccountProjects('fallback');
 // Existing implementation encrypts the selected Fallback Vercel token using
 // each repository Production environment's public key, then writes only its
 // VERCEL_TOKEN secret. Never read back encrypted Vercel Environment values.
 const repositories=await syncSourceGitHubCredentials('fallback');
 await db().query(
  `insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details)
   values($1,$2,'github_profile.fallback_prepared','system_settings','github_profile',$3)`,
  [actorUserId,actor,JSON.stringify({
   profile:'primary',standby:'fallback',github_secrets:repositories,
   secret_name:'VERCEL_TOKEN',scope:'production',
   deployments_triggered:false,source_mode_changed:false,database_changed:false,
  })]
 );
 return {repositories,prepared:repositories.length===3};
}

async function latestReadyDeployment(service:Service,token:string,teamId:string){
 let response:Response;
 try{response=await fetch('https://api.vercel.com/v6/deployments?projectId='+encodeURIComponent(service.projectId)+
  '&teamId='+encodeURIComponent(teamId)+'&target=production&state=READY&limit=1',{
   cache:'no-store',headers:{authorization:'Bearer '+token,accept:'application/json'},
   signal:AbortSignal.timeout(12000)
  });}catch{throw new Error('Vercel project health check timed out for '+service.repo);}
 if(!response.ok)throw new Error('Vercel denied the Production health check for '+service.repo+' (HTTP '+response.status+').');
 const data=await response.json() as {deployments?:Array<{id?:string;readyState?:string}>};
 return Array.isArray(data.deployments)&&data.deployments.length>0;
}
export async function inspectSourceDeployments(profile:SourceFamily){
 const {vercel,teamId}=credentials(profile);
 const statuses=await Promise.all(WORKFLOWS[profile].map(async service=>({
  repo:service.repo,projectId:service.projectId,
  ready:await latestReadyDeployment(service,vercel,teamId)
 })));
 return {profile,services:statuses,allReady:statuses.every(x=>x.ready)};
}
export async function dispatchSourceProductionDeployments(profile:SourceFamily,only?:string[]){
 const {github:token}=credentials(profile);
 const result:string[]=[];
 for(const service of WORKFLOWS[profile]){
  if(only&&!only.includes(service.repo))continue;
  const repo=service.repo.split('/').map(encodeURIComponent).join('/');
  await github('/repos/'+repo+'/actions/workflows/'+encodeURIComponent(service.workflow)+'/dispatches',token,'POST',{ref:'main'});
  result.push(service.repo);
 }
 return result;
}
/** Invoked from authenticated owner settings, including after an interrupted switch.
 * Never switches authority state or touches the database schema/deployer. */
export async function reconcileCurrentSourceServiceDeployments(actorUserId:string|null,actor:string){
 const settings=(await db().query('select github_profile from system_settings where id=true')).rows[0];
 const profile:SourceFamily=String(settings?.github_profile)==='fallback'?'fallback':'primary';
 const before=await inspectSourceDeployments(profile);
 if(before.allReady)return {profile,queued:[] as string[],ready:true};
 // Avoid queueing duplicate workflows on repeated page loads while GitHub
 // and Vercel are still building. Audit events provide durable deduplication.
 const recent=await db().query(
  "select 1 from audit_events where action='github_profile.services_queued' and details->>'profile'=$1 and created_at > now()-interval '10 minutes' limit 1",
  [profile]
 );
 if(recent.rowCount)return {profile,queued:[] as string[],ready:false,pending:true};
 // A source switch may have been interrupted. Provision only the selected account's
 // production secrets; then ask the selected workflows to create their own builds.
 const licenseEnv=await syncLicenseManagerAccountConnections(profile);
 const changed=await syncSourceGitHubCredentials(profile);
 const queued=await dispatchSourceProductionDeployments(profile,before.services.filter(s=>!s.ready).map(s=>s.repo));
 await db().query(
  "insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'github_profile.services_queued','system_settings','github_profile',$3)",
  [actorUserId,actor,JSON.stringify({profile,credential_targets:changed,license_manager_connections:licenseEnv,deployments_queued:queued,database_changed:false,domains_changed:false})]
 );
 return {profile,queued,ready:false};
}
