import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../../lib/auth';
import {db} from '../../../../../lib/db';
import {validateLicense} from '../../../../../lib/core/licenses';

type DomainMode='generated'|'vercel'|'custom';

function host(value:unknown){
  return String(value||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/$/,'');
}
function validHost(value:string){
  return Boolean(value&&value.length<=253&&/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value));
}
function httpsUrl(value:unknown){
  const raw=host(value);
  if(!validHost(raw))return null;
  return `https://${raw}`;
}
function normalizeMode(value:unknown):DomainMode{
  const mode=String(value||'generated').trim().toLowerCase();
  if(mode==='generated'||mode==='vercel'||mode==='custom')return mode;
  throw Object.assign(new Error('Unsupported Base Panel domain mode.'),{status:400,code:'PANEL_DOMAIN_MODE_INVALID'});
}
function domainSelection(input:any,generatedDomain:string|null){
  const mode=normalizeMode(input?.mode);
  let domainName:string|null=null;
  if(mode!=='generated'){
    domainName=host(input?.domain_name??input?.domainName);
    if(!validHost(domainName))throw Object.assign(new Error('Enter a valid public hostname.'),{status:400,code:'PANEL_DOMAIN_INVALID'});
    if(mode==='vercel'&&!domainName.endsWith('.vercel.app'))throw Object.assign(new Error('A custom Vercel address must end in .vercel.app.'),{status:400,code:'PANEL_VERCEL_DOMAIN_INVALID'});
    if(mode==='custom'&&domainName.endsWith('.vercel.app'))throw Object.assign(new Error('Use Vercel address mode for .vercel.app addresses.'),{status:400,code:'PANEL_CUSTOM_DOMAIN_INVALID'});
  }
  const verified=mode==='generated'?true:input?.verified===true;
  const effective=httpsUrl(input?.effective_url??input?.effectiveUrl);
  const effectiveHost=host(effective);
  const selectedHost=mode==='generated'?host(generatedDomain):host(domainName);
  const generatedHost=host(generatedDomain);
  const allowedEffective=mode==='custom'&&!verified
    ? new Set([selectedHost,generatedHost].filter(Boolean))
    : new Set([selectedHost].filter(Boolean));
  if(effective&&(!allowedEffective.size||!allowedEffective.has(effectiveHost)))throw Object.assign(new Error('The reported effective Panel URL does not match the selected domain state.'),{status:400,code:'PANEL_DOMAIN_EFFECTIVE_URL_MISMATCH'});
  return {mode,domain_name:domainName,verified,effective_url:effective};
}
async function activation(installationId:string,licenseId:string|null){
  const params:any[]=[installationId];
  const licenseFilter=licenseId?' and a.license_id=$2':'';
  if(licenseId)params.push(licenseId);
  return (await db().query(
    `select a.id,a.license_id,a.installation_id,a.status,a.metadata,
       p.slug product,
       base.project_id base_project_id,base.project_name base_project_name,base.deployment_id base_deployment_id,base.deployment_url base_deployment_url
     from activations a
     join licenses l on l.id=a.license_id
     join products p on p.id=l.product_id
     left join lateral (
       select e.project_id,e.project_name,e.deployment_id,e.deployment_url
       from deployment_events e
       where e.installation_id=a.installation_id and e.license_id=a.license_id and e.phase='completed'
         and e.action in ('deploy','base_update','redeploy','rollback')
         and coalesce(e.details->>'rollbackScope','base')='base'
       order by e.created_at desc limit 1
     ) base on true
     where a.installation_id=$1${licenseFilter} and p.slug='orbitfs_base'
     order by a.last_seen_at desc nulls last,a.first_seen_at desc limit 1`,
    params
  )).rows[0]||null;
}
function lockState(row:any){
  const lock=row?.metadata&&typeof row.metadata==='object'&&row.metadata.deployment_lock&&typeof row.metadata.deployment_lock==='object'?row.metadata.deployment_lock:{};
  return {
    deployment_locked:lock.locked===true,
    deployment_lock_reason:lock.locked===true?String(lock.reason||'').trim()||null:null,
    deployment_lock_changed_at:String(lock.changed_at||'').trim()||null,
    deployment_lock_changed_by:String(lock.changed_by||'').trim()||null,
  };
}
function state(row:any){
  const generatedDomain=row?.base_project_name?`${String(row.base_project_name).trim().toLowerCase()}.vercel.app`:null;
  const raw=row?.metadata&&typeof row.metadata==='object'&&row.metadata.panel_domain&&typeof row.metadata.panel_domain==='object'?row.metadata.panel_domain:{};
  let mode:DomainMode='generated';
  try{mode=normalizeMode(raw.mode)}catch{}
  let domainName=mode==='generated'?null:host(raw.domain_name||raw.domainName);
  if(domainName&&!validHost(domainName))domainName=null;
  const verified=mode==='generated'?true:raw.verified===true;
  const effective=typeof raw.effective_url==='string'&&httpsUrl(raw.effective_url)?httpsUrl(raw.effective_url):(mode==='generated'&&generatedDomain?`https://${generatedDomain}`:null);
  return {
    mode,
    domain_name:domainName,
    verified,
    effective_url:effective,
    generated_domain:generatedDomain,
    project_id:row?.base_project_id||null,
    project_name:row?.base_project_name||null,
    deployment_id:row?.base_deployment_id||null,
    deployment_url:row?.base_deployment_url||null,
    updated_at:String(raw.updated_at||'').trim()||null,
    updated_by:String(raw.updated_by||'').trim()||null,
    provider_checked_at:String(raw.provider_checked_at||'').trim()||null,
    ...lockState(row)
  };
}
async function authorize(request:Request,installationId:string,licenseId:string|null,write:boolean){
  const actor=await integrationAuthorized(request,write?'deployment.write':'deployment.read');
  if(actor)return {actor:String((actor as any).actor||(actor as any).name||'integration'),licenseId};
  const key=String(request.headers.get('x-license-key')||'').trim();
  if(!key)return null;
  const validation=await validateLicense({key,productSlug:'orbitfs_base',componentSlug:'orbitfs_base',installationId,action:'validate',userAgent:request.headers.get('user-agent')});
  if(!validation.valid||!validation.license_id)return null;
  if(licenseId&&licenseId!==String(validation.license_id))return null;
  return {actor:'orbitfs-base-runtime',licenseId:String(validation.license_id)};
}
function failure(error:any){
  return NextResponse.json({ok:false,code:String(error?.code||'PANEL_DOMAIN_ERROR'),error:String(error?.message||'Panel domain request failed')},{status:Number(error?.status||500),headers:{'cache-control':'no-store'}});
}

export async function GET(request:Request){
  try{
    const url=new URL(request.url);
    const installationId=String(url.searchParams.get('installation_id')||url.searchParams.get('installationId')||request.headers.get('x-installation-id')||'').trim();
    const requestedLicenseId=String(url.searchParams.get('license_id')||url.searchParams.get('licenseId')||'').trim()||null;
    if(!installationId)return NextResponse.json({ok:false,code:'INSTALLATION_ID_REQUIRED'},{status:400});
    const auth=await authorize(request,installationId,requestedLicenseId,false);
    if(!auth)return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});
    const row=await activation(installationId,auth.licenseId||requestedLicenseId);
    if(!row)return NextResponse.json({ok:false,code:'INSTALLATION_NOT_FOUND'},{status:404});
    return NextResponse.json({ok:true,authority:'orbitfs-license-master-v2',installation_id:installationId,license_id:row.license_id,panel_domain:state(row)},{headers:{'cache-control':'no-store'}});
  }catch(error){return failure(error)}
}

export async function POST(request:Request){
  try{
    const body=await request.json().catch(()=>({}));
    const installationId=String(body?.installation_id||body?.installationId||request.headers.get('x-installation-id')||'').trim();
    const requestedLicenseId=String(body?.license_id||body?.licenseId||'').trim()||null;
    if(!installationId)return NextResponse.json({ok:false,code:'INSTALLATION_ID_REQUIRED'},{status:400});
    const auth=await authorize(request,installationId,requestedLicenseId,true);
    if(!auth)return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});
    const row=await activation(installationId,auth.licenseId||requestedLicenseId);
    if(!row)return NextResponse.json({ok:false,code:'INSTALLATION_NOT_FOUND'},{status:404});
    if(row.status!=='active')return NextResponse.json({ok:false,code:'INSTALLATION_NOT_ACTIVE',error:'The Base installation must be active before its domain can be changed.'},{status:409});
    const lock=lockState(row);
    if(lock.deployment_locked)return NextResponse.json({ok:false,code:'INSTALLATION_DEPLOYMENT_LOCKED',error:lock.deployment_lock_reason||'Deployment is locked for this installation.',panel_domain:state(row)},{status:423});

    const action=String(body?.action||'authorize').trim().toLowerCase();
    if(action==='authorize'){
      return NextResponse.json({ok:true,authority:'orbitfs-license-master-v2',authorized:true,installation_id:installationId,license_id:row.license_id,panel_domain:state(row)},{headers:{'cache-control':'no-store'}});
    }
    if(action!=='record')return NextResponse.json({ok:false,code:'PANEL_DOMAIN_ACTION_INVALID'},{status:400});

    const generatedDomain=row.base_project_name?`${String(row.base_project_name).trim().toLowerCase()}.vercel.app`:null;
    const selected=domainSelection(body?.panel_domain||body,generatedDomain);
    const stamp=new Date().toISOString();
    const panelDomain={
      version:1,
      ...selected,
      generated_domain:generatedDomain,
      project_id:row.base_project_id||null,
      project_name:row.base_project_name||null,
      deployment_id:row.base_deployment_id||null,
      provider_checked_at:String(body?.provider_checked_at||body?.providerCheckedAt||stamp),
      updated_at:stamp,
      updated_by:auth.actor
    };
    const metadata={...(row.metadata&&typeof row.metadata==='object'?row.metadata:{}),panel_domain:panelDomain};
    await db().query('update activations set metadata=$2,last_seen_at=now() where id=$1',[row.id,JSON.stringify(metadata)]);
    await db().query(
      `insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details)
       values(null,$1,'installation.panel_domain','installation',$2,$3)`,
      [auth.actor,row.id,JSON.stringify({installation_id:installationId,license_id:row.license_id,panel_domain:panelDomain})]
    );
    const refreshed=await activation(installationId,String(row.license_id));
    return NextResponse.json({ok:true,authority:'orbitfs-license-master-v2',installation_id:installationId,license_id:row.license_id,panel_domain:state(refreshed)},{headers:{'cache-control':'no-store'}});
  }catch(error){return failure(error)}
}
