import { db } from '../db';
import {verifyVercelAccountProjects} from './source-vercel';

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
       status=excluded.status,
       result_code=excluded.result_code,
       error=excluded.error,
       resulting_license_state=excluded.resulting_license_state,
       resulting_revision=excluded.resulting_revision,
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
    ? ['ORBITFS_PRIMARY_GITHUB_TOKEN','ORBITFS_RELEASE_DISPATCH_TOKEN']
    : ['ORBITFS_FALLBACK_GITHUB_TOKEN'];
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
    for(const credential of credentials){
      const headers:Record<string,string>={accept:'application/vnd.github+json','x-github-api-version':'2022-11-28'};
      if(credential.value)headers.authorization='Bearer '+credential.value;
      const repoResponse=await fetch('https://api.github.com/repos/'+item.repo,{headers,cache:'no-store'});
      if(!repoResponse.ok)continue;
      const refResponse=await fetch('https://api.github.com/repos/'+item.repo+'/git/ref/heads/'+encodeURIComponent(item.ref),{headers,cache:'no-store'});
      if(!refResponse.ok)continue;
      const ref=await refResponse.json();
      const sha=String(ref?.object?.sha||'').trim();
      if(/^[a-f0-9]{40}$/i.test(sha)){verified={sha,credential:credential.name};break;}
    }
    if(!verified)throw new Error('Cannot activate '+profile.toUpperCase()+': no configured License Manager GitHub credential can read '+item.repo+'@'+item.ref);
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
   if(!yaml.includes('EXPECTED_GITHUB_PROFILE: '+profile)||
      !yaml.includes('secrets.VERCEL_TOKEN')){
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
  const before=(await db().query('select system_enabled,github_profile from system_settings where id=true')).rows[0];
  if(Boolean(before?.system_enabled))throw new Error('Turn Master Authority OFF before changing MAIN/FALLBACK mode.');
  const prior=String(before?.github_profile||'primary').toLowerCase()==='fallback'?'fallback':'primary';
  if(prior!==expected)throw new Error('Source mode changed since this page loaded. Refresh first.');

  // Do all external preflight checks before the DB transaction. If a target
  // account or deployment project is not configured, the switch stays put.
  const checked=await verifyGithubProfileTarget(next);
  const destinations=await verifyVercelWorkflowTargets(next);
  const projects=await verifyVercelAccountProjects(next);
  const pool=db();
  const client=await pool.connect();
  try{
    await client.query('begin');
    const current=(await client.query('select system_enabled,github_profile from system_settings where id=true for update')).rows[0];
    const actual=String(current?.github_profile||'primary').toLowerCase()==='fallback'?'fallback':'primary';
    if(Boolean(current?.system_enabled))throw new Error('Master Authority must be OFF before changing MAIN/FALLBACK mode');
    if(actual!==expected)throw new Error('Source mode changed since this page was loaded. Refresh before switching.');
    const updated=(await client.query('update system_settings set github_profile=$1,updated_at=now() where id=true returning *',[next])).rows[0];
    await client.query(
      `insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details)
       values($1,$2,'github_profile.changed','system_settings','github_profile',$3)`,
      [actorUserId,actor,JSON.stringify({
        from:actual,to:next,master_authority_offline:true,
        acknowledged:true,github_targets:checked,
        vercel_deployment_workflows:destinations,
        verified_vercel_projects:projects,
        database_source:'lucaskerim123/Master-Database-System',
        database_changes:false,deployments_triggered:false,
      })],
    );
    await client.query('commit');
    return updated;
  }catch(error){
    await client.query('rollback').catch(()=>{});
    throw error;
  }finally{
    client.release();
  }
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
