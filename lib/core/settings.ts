import {resumeSourceServices,restoreResumedSourceServices,pausePreviousSourceServices} from './source-pause';
import { db } from '../db';
import {verifyVercelAccountProjects} from './source-vercel';
import {syncSourceGitHubCredentials,syncLicenseManagerAccountConnections,inspectSourceDeployments} from './source-activation';

export type SettingField='system_enabled'|'licensing_enabled'|'maintenance_mode'|'customer_self_unlock_enabled'|'release_system_enabled'|'auto_technical_approval_enabled'|'deployment_enabled'|'base_deployment_enabled'|'update_deployment_enabled'|'rollback_enabled';
export type GithubProfileName='primary'|'fallback';
export type RuntimePolicy={
  validation_ttl_seconds:number;
  offline_grace_seconds:number;
  pulse_poll_seconds:number;
  max_failed_validations:number;
  allow_offline_grace:boolean;
};
export type PulseAction='full_recheck'|'revalidate_license'|'refresh_entitlements'|'refresh_binding'|'refresh_runtime_policy'|'refresh_authority'|'invalidate_cache'|'request_check_in'|'refresh_release_access';
export type PulseScope='global'|'product'|'license'|'installation'|'component';

const PULSE_ACTIONS:PulseAction[]=['full_recheck','revalidate_license','refresh_entitlements','refresh_binding','refresh_runtime_policy','refresh_authority','invalidate_cache','request_check_in','refresh_release_access'];
const PULSE_SCOPES:PulseScope[]=['global','product','license','installation','component'];

function pulseActionFromReason(reason:string):PulseAction{
  const value=String(reason||'').toLowerCase();
  if(value.includes('runtime-policy'))return 'refresh_runtime_policy';
  if(value.includes('authority-setting')||value.includes('authority-recheck'))return 'refresh_authority';
  if(value.includes('installation')||value.includes('binding'))return 'refresh_binding';
  if(value.includes('component')||value.includes('entitlement'))return 'refresh_entitlements';
  if(value.includes('release-access'))return 'refresh_release_access';
  if(value.includes('check-in'))return 'request_check_in';
  if(value.includes('invalidate-cache'))return 'invalidate_cache';
  if(value.includes('reactivated')||value.includes('license-active')||value.includes('full-license-recheck'))return 'full_recheck';
  if(value.includes('suspend')||value.includes('revoke')||value.includes('expired')||value.includes('terminate')||value.includes('deleted')||value.includes('key-rotated')||value.includes('validation-recheck'))return 'revalidate_license';
  return 'full_recheck';
}

function pulseScopeFromDetails(details:Record<string,unknown>):PulseScope{
  const explicit=String((details as any).pulse_scope||'').trim().toLowerCase() as PulseScope;
  if(PULSE_SCOPES.includes(explicit))return explicit;
  if((details as any).installation_id)return 'installation';
  if((details as any).license_id)return 'license';
  if((details as any).product)return 'product';
  if((details as any).component)return 'component';
  return 'global';
}

function cleanPulsePayload(details:Record<string,unknown>){
  const payload={...details} as Record<string,unknown>;
  delete payload.pulse_action;
  delete payload.pulse_scope;
  delete payload.requires_ack;
  delete payload.expires_at;
  return payload;
}

export async function getSettings() {
  return (await db().query('select * from system_settings where id=true')).rows[0];
}

export async function sendPulse(actorUserId:string|null,actor:string,reason:string,details:Record<string,unknown>={}) {
  const reasonText=String(reason||'manual').slice(0,160);
  const requestedAction=String((details as any).pulse_action||'').trim().toLowerCase() as PulseAction;
  const pulseAction:PulseAction=PULSE_ACTIONS.includes(requestedAction)?requestedAction:pulseActionFromReason(reasonText);
  const scope=pulseScopeFromDetails(details);
  const licenseId=(details as any).license_id?String((details as any).license_id):null;
  const installationId=(details as any).installation_id?String((details as any).installation_id):null;
  const product=(details as any).product?String((details as any).product).toLowerCase():null;
  const component=(details as any).component?String((details as any).component).toLowerCase():null;
  const requiresAck=(details as any).requires_ack===undefined?true:Boolean((details as any).requires_ack);
  const expiresAt=(details as any).expires_at?String((details as any).expires_at):null;
  const payload=cleanPulsePayload(details);

  const result=await db().query(
    `update system_settings
       set pulse_revision=coalesce(pulse_revision,0)+1,
           pulse_at=now(),
           pulse_reason=$1,
           updated_at=now()
     where id=true
     returning pulse_revision,pulse_at,pulse_reason,validation_ttl_seconds,offline_grace_seconds,pulse_poll_seconds,max_failed_validations,allow_offline_grace`,
    [reasonText],
  );
  const pulse=result.rows[0];
  let directive:any=null;
  try{
    directive=(await db().query(
      `insert into license_pulses(revision,action,scope,license_id,installation_id,product,component,reason,payload,requires_ack,created_by_user_id,created_by,expires_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning id,revision,action,scope,license_id,installation_id,product,component,reason,payload,requires_ack,created_at,expires_at`,
      [pulse.pulse_revision,pulseAction,scope,licenseId,installationId,product,component,reasonText,JSON.stringify(payload),requiresAck,actorUserId,actor,expiresAt],
    )).rows[0];
  }catch(error:any){
    if(error?.code!=='42P01')throw error;
  }
  await db().query(
    `insert into audit_events(actor_user_id,actor,action,resource_type,details)
     values($1,$2,'authority.pulse','system_settings',$3)`,
    [actorUserId,actor,JSON.stringify({reason:pulse.pulse_reason,pulse_revision:pulse.pulse_revision,pulse_action:pulseAction,pulse_scope:scope,license_id:licenseId,installation_id:installationId,product,component,...payload})],
  );
  return {...pulse,directive};
}

export async function listApplicablePulses(input:{sinceRevision?:number;licenseId?:string|null;installationId?:string|null;product?:string|null;component?:string|null;limit?:number}){
  const since=Math.max(0,Number.isFinite(Number(input.sinceRevision))?Math.floor(Number(input.sinceRevision)):0);
  const limit=Math.min(100,Math.max(1,Math.floor(Number(input.limit||50))));
  const params:any[]=[since];
  const applies:string[]=[`p.scope='global'`];
  const add=(value:any)=>{params.push(value);return '$'+params.length;};
  const licenseParam=input.licenseId?add(String(input.licenseId)):null;

  if(input.product){
    const productParam=add(String(input.product).toLowerCase());
    applies.push(`(p.scope='product' and p.product=${productParam})`);
  }
  if(licenseParam){
    applies.push(`(p.scope='license' and p.license_id::text=${licenseParam})`);
  }
  if(input.installationId){
    const installationParam=add(String(input.installationId));
    applies.push(`(p.scope='installation' and p.installation_id=${installationParam} and (p.license_id is null${licenseParam?` or p.license_id::text=${licenseParam}`:''}))`);
  }
  if(input.component){
    const componentParam=add(String(input.component).toLowerCase());
    applies.push(`(p.scope='component' and p.component=${componentParam} and (p.license_id is null${licenseParam?` or p.license_id::text=${licenseParam}`:''}))`);
  }

  const limitParam=add(limit);
  try{
    return (await db().query(
      `select p.id,p.revision,p.action,p.scope,p.license_id,p.installation_id,p.product,p.component,p.reason,p.payload,p.requires_ack,p.created_at,p.expires_at
       from license_pulses p
       where p.revision>$1
         and (p.expires_at is null or p.expires_at>now())
         and (${applies.join(' or ')})
       order by p.revision asc
       limit ${limitParam}`,
      params,
    )).rows;
  }catch(error:any){
    if(error?.code==='42P01')return [];
    throw error;
  }
}

function pulseAppliesToClient(pulse:any,input:{licenseId?:string|null;installationId:string;product?:string|null;component?:string|null}){
  const scope=String(pulse.scope||'global') as PulseScope;
  if(scope==='global')return true;
  if(scope==='product')return Boolean(input.product)&&String(input.product).toLowerCase()===String(pulse.product||'').toLowerCase();
  if(scope==='license')return Boolean(input.licenseId)&&String(input.licenseId)===String(pulse.license_id||'');
  if(scope==='installation')return String(input.installationId)===String(pulse.installation_id||'')&&(!pulse.license_id||String(input.licenseId||'')===String(pulse.license_id));
  if(scope==='component')return Boolean(input.component)&&String(input.component).toLowerCase()===String(pulse.component||'').toLowerCase()&&(!pulse.license_id||String(input.licenseId||'')===String(pulse.license_id));
  return false;
}

export async function acknowledgePulse(input:{
  pulseId?:string|null;
  revision?:number|null;
  licenseId?:string|null;
  installationId:string;
  product?:string|null;
  component?:string|null;
  client?:string|null;
  clientVersion?:string|null;
  status:'received'|'applied'|'failed';
  resultCode?:string|null;
  error?:string|null;
  resultingLicenseState?:string|null;
  resultingRevision?:number|null;
  details?:Record<string,unknown>;
}){
  const installationId=String(input.installationId||'').trim().slice(0,200);
  if(!installationId)throw Object.assign(new Error('installation_id is required'),{status:400,code:'INSTALLATION_ID_REQUIRED'});
  let pulse:any;
  try{
    if(input.pulseId){
      pulse=(await db().query('select id,revision,action,scope,license_id,installation_id,product,component,reason,requires_ack,expires_at from license_pulses where id=$1 limit 1',[String(input.pulseId)])).rows[0];
    }else if(Number.isFinite(Number(input.revision))){
      pulse=(await db().query('select id,revision,action,scope,license_id,installation_id,product,component,reason,requires_ack,expires_at from license_pulses where revision=$1 limit 1',[Math.floor(Number(input.revision))])).rows[0];
    }
  }catch(error:any){
    if(error?.code==='42P01')return {ok:true,skipped:true,reason:'PULSE_SCHEMA_NOT_AVAILABLE'};
    throw error;
  }
  if(!pulse)throw Object.assign(new Error('Pulse directive not found'),{status:404,code:'PULSE_NOT_FOUND'});
  if(!pulseAppliesToClient(pulse,{licenseId:input.licenseId,installationId,product:input.product,component:input.component})){
    throw Object.assign(new Error('Pulse directive does not apply to this installation'),{status:403,code:'PULSE_TARGET_MISMATCH'});
  }
  const status=input.status;
  const row=(await db().query(
    `insert into license_pulse_receipts(pulse_id,license_id,installation_id,client,client_version,status,result_code,error,resulting_license_state,resulting_revision,details,applied_at,updated_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,case when $6 in ('applied','failed') then now() else null end,now())
     on conflict(pulse_id,installation_id) do update set
       license_id=coalesce(excluded.license_id,license_pulse_receipts.license_id),
       client=coalesce(excluded.client,license_pulse_receipts.client),
       client_version=coalesce(excluded.client_version,license_pulse_receipts.client_version),
       status=case
         when license_pulse_receipts.status in ('applied','failed') and excluded.status='received'
           then license_pulse_receipts.status
         else excluded.status end,
       result_code=case when excluded.status='received' and license_pulse_receipts.status in ('applied','failed')
         then license_pulse_receipts.result_code else excluded.result_code end,
       error=case when excluded.status='received' and license_pulse_receipts.status in ('applied','failed') then license_pulse_receipts.error else excluded.error end,
       resulting_license_state=case when excluded.status='received' and license_pulse_receipts.status in ('applied','failed') then license_pulse_receipts.resulting_license_state else excluded.resulting_license_state end,
       resulting_revision=case when excluded.status='received' and license_pulse_receipts.status in ('applied','failed') then license_pulse_receipts.resulting_revision else excluded.resulting_revision end,
       details=license_pulse_receipts.details||excluded.details,
       applied_at=case when excluded.status in ('applied','failed') then now() else license_pulse_receipts.applied_at end,
       updated_at=now()
     returning pulse_id,installation_id,status,result_code,error,received_at,applied_at,updated_at`,
    [pulse.id,input.licenseId??null,installationId,input.client??null,input.clientVersion??null,status,input.resultCode??null,input.error??null,input.resultingLicenseState??null,input.resultingRevision??null,JSON.stringify(input.details??{})],
  )).rows[0];
  return {ok:true,receipt:row,pulse:{id:pulse.id,revision:Number(pulse.revision),action:pulse.action,scope:pulse.scope}};
}

export async function listRecentPulses(limit=20){
  const safeLimit=Math.min(100,Math.max(1,Math.floor(Number(limit)||20)));
  try{
    return (await db().query(
      `select p.id,p.revision,p.action,p.scope,p.license_id,p.installation_id,p.product,p.component,p.reason,p.requires_ack,p.created_at,p.expires_at,
              count(r.id)::int receipt_count,
              count(r.id) filter(where r.status='received')::int received_count,
              count(r.id) filter(where r.status='applied')::int applied_count,
              count(r.id) filter(where r.status='failed')::int failed_count,
              max(r.updated_at) last_receipt_at
       from license_pulses p
       left join license_pulse_receipts r on r.pulse_id=p.id
       group by p.id
       order by p.revision desc
       limit $1`,
      [safeLimit],
    )).rows;
  }catch(error:any){
    if(error?.code==='42P01')return [];
    throw error;
  }
}

export async function setSetting(field:SettingField,value:boolean,actorUserId:string|null,actor:string) {
  const allowed:SettingField[]=['system_enabled','licensing_enabled','maintenance_mode','customer_self_unlock_enabled','release_system_enabled','auto_technical_approval_enabled','deployment_enabled','base_deployment_enabled','update_deployment_enabled','rollback_enabled'];
  if(!allowed.includes(field))throw new Error('Unsupported authority setting');
  const before=await getSettings();
  const result=await db().query(`update system_settings set ${field}=$1, updated_at=now() where id=true returning *`,[value]);
  await db().query(
    `insert into audit_events(actor_user_id,actor,action,resource_type,details)
     values($1,$2,$3,'system_settings',$4)`,
    [actorUserId,actor,`settings.set.${field}`,JSON.stringify({field,previous:Boolean(before?.[field]),value})],
  );
  if(Boolean(before?.[field])!==value)await sendPulse(actorUserId,actor,`authority-setting:${field}`,{field,value,pulse_action:'refresh_authority',pulse_scope:'global'});
  return result.rows[0];
}

export async function toggleSetting(field:SettingField,actorUserId:string,actor:string) {
  const current=await getSettings();
  return setSetting(field,!Boolean(current?.[field]),actorUserId,actor);
}

export async function getGithubProfile():Promise<GithubProfileName>{
  // Read authoritative DB state each time: a stale 20-minute cache could
  // let the former GitHub/Vercel family continue working after a switch.
  const row=(await db().query('select github_profile from system_settings where id=true')).rows[0];
  return String(row?.github_profile||'primary').toLowerCase()==='fallback'?'fallback':'primary';
}

const GITHUB_PROFILE_TARGETS:Record<GithubProfileName,{tokenEnv:string;repos:Array<{repo:string;ref:string}>}>={
  primary:{
    tokenEnv:'ORBITFS_RELEASE_DISPATCH_TOKEN',
    repos:[
      {repo:'lucaskerim123/Custom-licence-manager',ref:'main'},
      {repo:'lucaskerim123/V2_Billing_Store',ref:'main'},
      {repo:'lucaskerim123/Dev-panel',ref:'main'},
      {repo:'lucaskerim123/V1-vercel-base',ref:'base-release'},
      {repo:'lucaskerim123/V1-vercel-engine',ref:'UPDATE_RELEASE'},
    ],
  },
  fallback:{
    tokenEnv:'ORBITFS_FALLBACK_GITHUB_TOKEN',
    repos:[
      {repo:'remipetrovich-design/OrbitFS-License-Administration',ref:'main'},
      {repo:'remipetrovich-design/OrbitFS-Billing-Shopfront',ref:'main'},
      {repo:'remipetrovich-design/OrbitFS-Control-Centre',ref:'main'},
      {repo:'remipetrovich-design/OrbitFS-Base-System',ref:'base-release'},
      {repo:'remipetrovich-design/OrbitFS_Engine',ref:'UPDATE_RELEASE'},
    ],
  },
};

function githubCredentialCandidates(profile:GithubProfileName){
  // A GitHub account is verified only with its own account token. Never
  // silently use the Main token to authenticate a Fallback handoff.
  const names=profile==='primary'
    ? ['MAIN_GITHUB_TOKEN','MAIN_GITHUB_RELEASE_TOKEN','ORBITFS_PRIMARY_GITHUB_TOKEN','ORBITFS_RELEASE_DISPATCH_TOKEN']
    : ['FALLBACK_GITHUB_TOKEN','FALLBACK_GITHUB_RELEASE_TOKEN','ORBITFS_FALLBACK_GITHUB_TOKEN'];
  return names.map(name=>({name,value:String(process.env[name]||'').trim()}))
    .filter(item=>Boolean(item.value));
}

async function verifyGithubProfileTarget(profile:GithubProfileName){
  const target=GITHUB_PROFILE_TARGETS[profile];
  const credentials=githubCredentialCandidates(profile);
  const checked:Array<{repo:string;ref:string;sha:string;credential:string}>=[];
  if(!credentials.length)throw new Error('Cannot activate '+profile.toUpperCase()+': no configured GitHub credential is available for the target repository family');
  for(const item of target.repos){
    let verified:{sha:string;credential:string}|null=null;
    const failures:string[]=[];
    for(const credential of credentials){
      const headers:Record<string,string>={accept:'application/vnd.github+json','x-github-api-version':'2022-11-28'};
      if(credential.value)headers.authorization='Bearer '+credential.value;
      const repoResponse=await fetch('https://api.github.com/repos/'+item.repo,{headers,cache:'no-store'});
      if(!repoResponse.ok){failures.push(credential.name+' repository HTTP '+repoResponse.status);continue;}
      const refResponse=await fetch('https://api.github.com/repos/'+item.repo+'/git/ref/heads/'+encodeURIComponent(item.ref),{headers,cache:'no-store'});
      if(!refResponse.ok){failures.push(credential.name+' branch HTTP '+refResponse.status);continue;}
      const ref=await refResponse.json();
      const sha=String(ref?.object?.sha||'').trim();
      if(/^[a-f0-9]{40}$/i.test(sha)){verified={sha,credential:credential.name};break;}
      failures.push(credential.name+' returned an invalid branch SHA');
    }
    if(!verified)throw new Error('Cannot activate '+profile.toUpperCase()+': '+item.repo+'@'+item.ref+' could not be verified. '+failures.join('; ')+'. Check the variable in the deployed License Manager Production environment and grant that token repository access.');
    checked.push({repo:item.repo,ref:item.ref,sha:verified.sha,credential:verified.credential});
  }
  return checked;
}

type VercelWorkflowTarget={
  repo:string;file:string;team:string;project:string;
};
const VERCEL_WORKFLOWS:Record<GithubProfileName,VercelWorkflowTarget[]>={
 primary:[
  {repo:'lucaskerim123/Custom-licence-manager',file:'quick-deploy.yml',team:'team_W3fS0X03YCjNkD2BoqRj6Uld',project:'prj_rxRaSrRX2xwnmJ21zfjYL31RkLsv'},
  {repo:'lucaskerim123/Dev-panel',file:'deploy-dev-panel.yml',team:'team_W3fS0X03YCjNkD2BoqRj6Uld',project:'prj_o5ju4zFGSDZelX4SA7GAu3rQqtap'},
  {repo:'lucaskerim123/V2_Billing_Store',file:'quick-redesign-deploy.yml',team:'team_W3fS0X03YCjNkD2BoqRj6Uld',project:'prj_3ARdg4cRikU2OiMeZjZDvQ3JuEZd'},
 ],
 fallback:[
  {repo:'remipetrovich-design/OrbitFS-License-Administration',file:'quick-deploy.yml',team:'team_0fWVaLb24pyeeCRqqYu5G47K',project:'prj_rCooJWY8JMkBjekXLO8scT35UPJ8'},
  {repo:'remipetrovich-design/OrbitFS-Control-Centre',file:'deploy-dev-panel.yml',team:'team_0fWVaLb24pyeeCRqqYu5G47K',project:'prj_24FvbyWw7CAEbiug1Ec18p51z7WJ'},
  {repo:'remipetrovich-design/OrbitFS-Billing-Shopfront',file:'quick-redesign-deploy.yml',team:'team_0fWVaLb24pyeeCRqqYu5G47K',project:'prj_BZNKPOm5pTcMdD4QrOXPOqpE7Imq'},
 ],
};

async function verifyVercelWorkflowTargets(profile:GithubProfileName){
 const credentials=githubCredentialCandidates(profile);
 const targets=VERCEL_WORKFLOWS[profile];
 const checked:Array<{repo:string;team:string;project:string}>=[];
 for(const target of targets){
  let valid=false;
  for(const credential of credentials){
   const response=await fetch(
    'https://api.github.com/repos/'+target.repo+'/contents/.github/workflows/'+target.file+'?ref=main',
    {headers:{accept:'application/vnd.github+json',authorization:'Bearer '+credential.value,'x-github-api-version':'2022-11-28'},
     cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(!response.ok)continue;
   const body=await response.json();
   if(body.encoding!=='base64'||typeof body.content!=='string')continue;
   const yaml=Buffer.from(body.content.replace(/\\s/g,''),'base64').toString('utf8');
   const read=(key:string)=>new RegExp('^\\s*'+key+':\\s*([^\\s#]+)','m').exec(yaml)?.[1]||'';
   if(read('VERCEL_ORG_ID')!==target.team||read('VERCEL_PROJECT_ID')!==target.project){
    throw new Error('Wrong Vercel target in '+target.repo+' workflow '+target.file+
      '. Correct its account/project configuration before switching.');
   }
   const manualLicenseWorkflow=target.repo.endsWith('/Custom-licence-manager')||
      target.repo.endsWith('/OrbitFS-License-Administration');
   const expectedGuard=manualLicenseWorkflow
      ?yaml.includes('Authorize manual standby deployment')&&yaml.includes('workflow_dispatch')
      :yaml.includes('EXPECTED_GITHUB_PROFILE: '+profile)&&yaml.includes('workflow_dispatch');
   if(!expectedGuard||!yaml.includes('secrets.VERCEL_TOKEN')){
    throw new Error('Source profile or production Vercel token check is missing in '+target.repo);
   }
   valid=true;break;
  }
  if(!valid)throw new Error('Could not verify the production Vercel workflow in '+target.repo+
    '. Check '+profile+' GitHub account token permissions.');
  checked.push({repo:target.repo,team:target.team,project:target.project});
 }
 return checked;
}


/** Post-commit shutdown: no deployment or database migration is dispatched.
 * A Vercel failure leaves the new source authority selected and is reported.
 */
async function shutdownPreviousSourceAfterCutover(
 next:GithubProfileName,previous:GithubProfileName,
 revision:number,actorUserId:string|null,actor:string
){
 const selected=await inspectSourceDeployments(next);
 if(!selected.allReady)
  throw new Error('Selected source services are no longer healthy; previous services remain available.');
 const url=next==='primary'
  ?'https://incendiarynetworks.cc/api/v1/source-configuration'
  :'https://lm.incendiarynetworks.cc/api/v1/source-configuration';
 const response=await fetch(url,{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(8000)});
 if(!response.ok)
  throw new Error('Selected License Manager source API is unavailable (HTTP '+response.status+'); previous services remain available.');
 const configuration=await response.json() as {mode?:string};
 if(configuration.mode!==(next==='primary'?'main':'fallback'))
  throw new Error('Selected License Manager has not confirmed new source mode; previous services remain available.');
 const assertSelectedAuthority=async()=>{
  const current=(await db().query('select github_profile from system_settings where id=true')).rows[0];
  if(String(current?.github_profile)!==next)
   throw new Error('Source authority changed during previous-project shutdown. Stopped safely.');
 };
 await assertSelectedAuthority();
 const previouslyPaused=(await db().query(
  `select distinct details->>'project_id' as project_id from audit_events
   where action='github_profile.previous_project_paused' and details->>'revision'=$1`,
  [String(revision)]
 )).rows.map((row:any)=>String(row.project_id||'')).filter(Boolean);
 return pausePreviousSourceServices(previous,assertSelectedAuthority,async(projectId,state,reason)=>{
  await db().query(
   `insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details)
    values($1,$2,$3,'vercel_project',$4,$5)`,
   [actorUserId,actor,state==='paused'?'github_profile.previous_project_paused':'github_profile.previous_project_pause_failed',
    projectId,JSON.stringify({revision,from:previous,to:next,project_id:projectId,reason:reason||null,deployments_triggered:false})]
  );
 },previouslyPaused);
}

export async function setGithubProfile(
  next:GithubProfileName,
  expected:GithubProfileName,
  acknowledged:boolean,
  actorUserId:string|null,
  actor:string,
){
  if(next!=='primary'&&next!=='fallback')throw new Error('Invalid GitHub profile');
  if(expected!=='primary'&&expected!=='fallback')throw new Error('Invalid current GitHub profile');
  if(next===expected)throw new Error('Requested GitHub profile is already active');
  if(!acknowledged)throw new Error('Tick the switch acknowledgment checkbox before changing source mode');

  // First verify the authority interlock and stale form data. The DB
  // transaction below repeats both checks under a row lock before mutation.
  const before=(await db().query('select system_enabled,maintenance_mode,github_profile from system_settings where id=true')).rows[0];
  const prior=String(before?.github_profile||'primary').toLowerCase()==='fallback'?'fallback':'primary';
  if(prior!==expected)throw new Error('Source mode changed since this page loaded. Refresh first.');

  // Do all external preflight checks before the DB transaction. If a target
  // account or deployment project is not configured, the switch stays put.
  const checked=await verifyGithubProfileTarget(next);
  const destinations=await verifyVercelWorkflowTargets(next);
  const projects=await verifyVercelAccountProjects(next);
  // Before changing authoritative mode, securely install the correct Vercel
  // account token into each selected GitHub Production environment.
  const vercelLicenseCredentials=await syncLicenseManagerAccountConnections(next);
  const githubSecrets=await syncSourceGitHubCredentials(next);
  // Stage the destination while keeping the old family authoritative. A
  // deployment dispatch is not proof of readiness and must never flip mode.
  // A paused destination must be resumed before its fresh deployment can be checked.
  const resumed:string[]=[];
  let handoverCommitted=false;
  // An unsuccessful handover must not leave newly resumed standby services
  // exposed. Track partial success even when Vercel rejects later projects.
  try{
    await resumeSourceServices(next,resumed);
  const destination=await inspectSourceDeployments(next);
  if(!destination.allReady){
    const absent=destination.services.filter(service=>!service.ready)
      .map(service=>service.repo+' ('+service.reason+')');
    throw new Error('Destination projects resumed, but production services are not operational: '+absent.join('; ')+
      '. No deployment was queued and the current mode remains active.');
  }
  // Current production commits are diagnostic only. Switching to an already
  // functioning standby must not silently trigger a build or redeployment.
  const outdated=destination.services.filter(service=>!service.current).map(service=>service.repo);

  const pool=db();
  const client=await pool.connect();
  try{
    await client.query('begin');
    const current=(await client.query('select system_enabled,maintenance_mode,github_profile from system_settings where id=true for update')).rows[0];
    const actual=String(current?.github_profile||'primary').toLowerCase()==='fallback'?'fallback':'primary';
    if(actual!==expected)throw new Error('Source mode changed since this page was loaded. Refresh before switching.');
    // Publish the mode and pulse revision in the same transaction. This avoids
    // a selected mode becoming visible without a durable refresh directive.
    const updated=(await client.query(
      `update system_settings set github_profile=$1,
       pulse_revision=coalesce(pulse_revision,0)+1,
       pulse_at=now(),pulse_reason='source-mode-changed',updated_at=now()
       where id=true returning *`,[next]
    )).rows[0];
    await client.query(
      `insert into license_pulses(revision,action,scope,reason,payload,requires_ack,created_by_user_id,created_by)
       values($1,'refresh_authority','global','source-mode-changed',$2,true,$3,$4)`,
      [updated.pulse_revision,JSON.stringify({
        source:'github-profile-switch',from:actual,to:next,
        mode:next==='primary'?'main':'fallback',
        license_api:next==='primary'?'https://incendiarynetworks.cc/api/v1':'https://lm.incendiarynetworks.cc/api/v1',
        base_source:next==='primary'
          ?{repo:'lucaskerim123/V1-vercel-base',ref:'base-release'}
          :{repo:'remipetrovich-design/OrbitFS-Base-System',ref:'base-release'},
        inner_deployer_source:next==='primary'
          ?{repo:'lucaskerim123/V1-vercel-engine',ref:'UPDATE_RELEASE'}
          :{repo:'remipetrovich-design/OrbitFS_Engine',ref:'UPDATE_RELEASE'}
       }),actorUserId,actor]
    );
    await client.query(
      `insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details)
       values($1,$2,'github_profile.changed','system_settings','github_profile',$3)`,
      [actorUserId,actor,JSON.stringify({
        from:actual,to:next,handover_interlock:'owner_confirmed',
        acknowledged:true,github_targets:checked,
        vercel_deployment_workflows:destinations,
        verified_vercel_projects:projects,
        destination_production_current:destination.allCurrent,
        destination_outdated_repositories:outdated,
        verified_github_production_credentials:githubSecrets,
        synchronized_license_manager_connections:vercelLicenseCredentials,
        database_source:'lucaskerim123/Master-Database-System',
        database_changes:false,deployments_triggered:false,
      })],
    );
    await client.query('commit');
    handoverCommitted=true;
    // Verify the selected authority after commit, then pause the old family.
    // A partial shutdown never rolls the authoritative DB mode back.
    let paused:string[]=[];
    let failed:string[]=[];
    try{
      const result=await shutdownPreviousSourceAfterCutover(next,actual,Number(updated.pulse_revision),actorUserId,actor);
      paused=result.paused;
      failed=result.failed;
    }catch(error){
      failed=[error instanceof Error?error.message:String(error)];
      await db().query(
       `insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details)
        values($1,$2,'github_profile.previous_shutdown_incomplete','system_settings','github_profile',$3)`,
       [actorUserId,actor,JSON.stringify({revision:Number(updated.pulse_revision),from:actual,to:next,reason:failed[0]})]
      ).catch(()=>{});
    }
    return {...updated,sourceActivation:{
      queued:[],failed,paused,pendingPreviousShutdown:failed.length>0,
      pulseRevision:Number(updated.pulse_revision)
    }};

  }catch(error){
    await client.query('rollback').catch(()=>{});
    throw error;
  }finally{
    client.release();
  }  }catch(error){
    if(handoverCommitted)throw error;
    const restoreFailures=await restoreResumedSourceServices(next,resumed);
    const reason=error instanceof Error?error.message:String(error);
    throw new Error(reason+(restoreFailures.length
      ? ' Standby restoration INCOMPLETE: '+restoreFailures.join('; ')
      : ' Standby projects restored; previous source mode remains active.'));
  }

}

export async function getSourceHandoverStatus(){
 const settings=await getSettings();
 const mode=settings?.github_profile==='fallback'?'fallback':'main';
 const result=(await db().query(
  `select id,revision,created_at,payload from license_pulses
   where action='refresh_authority' and reason='source-mode-changed'
   order by revision desc limit 1`
 )).rows[0];
 if(!result)return {mode,stage:'no_handover',revision:null,received:0,applied:0,failed:0};
 const receipts=(await db().query(
  `select status,count(*)::int as count from license_pulse_receipts
   where pulse_id=$1 group by status`,[result.id]
 )).rows;
 const counts=Object.fromEntries(receipts.map((row:any)=>[String(row.status),Number(row.count)]));
 const applied=counts.applied||0,failed=counts.failed||0,received=counts.received||0;
 const pausedRows=(await db().query(
  `select distinct details->>'project_id' as project_id from audit_events
   where action='github_profile.previous_project_paused' and details->>'revision'=$1`,
  [String(result.revision)]
 )).rows;
 const pausedProjects=pausedRows.map((row:any)=>String(row.project_id||'')).filter(Boolean);
 const complete=pausedProjects.length===3;
 return {
  mode,revision:Number(result.revision),startedAt:result.created_at,
  stage:complete?'previous_paused':failed?'runtime_failed':applied?'runtime_acknowledged':'awaiting_runtime_ack',
  received,applied,failed,
  previousShutdown:{complete,pausedProjects},
  // Customer routing cannot be inferred from pulse receipts or Vercel responses.
  confirmed:false,shutdownAllowed:false,
  reason:complete
   ?'Previous Vercel projects paused. Customer routing requires separate verification.'
   :'Previous-project shutdown incomplete or pending; pulse receipts are not route attestations.'
 };
}

export async function updateRuntimePolicy(input:Partial<RuntimePolicy>,actorUserId:string|null,actor:string){
  const current=await getSettings();
  const clamp=(value:unknown,min:number,max:number,fallback:number)=>{
    const n=Number(value);
    return Number.isFinite(n)?Math.min(max,Math.max(min,Math.floor(n))):fallback;
  };
  const next:RuntimePolicy={
    validation_ttl_seconds:clamp(input.validation_ttl_seconds,60,86400,Number(current?.validation_ttl_seconds||5400)),
    offline_grace_seconds:clamp(input.offline_grace_seconds,0,604800,Number(current?.offline_grace_seconds||0)),
    pulse_poll_seconds:clamp(input.pulse_poll_seconds,60,86400,Number(current?.pulse_poll_seconds||5400)),
    max_failed_validations:clamp(input.max_failed_validations,1,100,Number(current?.max_failed_validations||3)),
    allow_offline_grace:input.allow_offline_grace===undefined?Boolean(current?.allow_offline_grace):Boolean(input.allow_offline_grace),
  };
  if(!next.allow_offline_grace)next.offline_grace_seconds=0;
  await db().query(
    `update system_settings set validation_ttl_seconds=$1,offline_grace_seconds=$2,pulse_poll_seconds=$3,max_failed_validations=$4,allow_offline_grace=$5,updated_at=now() where id=true returning *`,
    [next.validation_ttl_seconds,next.offline_grace_seconds,next.pulse_poll_seconds,next.max_failed_validations,next.allow_offline_grace],
  );
  await db().query(
    `insert into audit_events(actor_user_id,actor,action,resource_type,details)
     values($1,$2,'settings.runtime_policy','system_settings',$3)`,
    [actorUserId,actor,JSON.stringify(next)],
  );
  await sendPulse(actorUserId,actor,'runtime-policy-changed',{...next,pulse_action:'refresh_runtime_policy',pulse_scope:'global'});
  return await getSettings();
}
