import crypto from 'node:crypto';
import { db } from '../db';
import { sendPulse } from './settings';
import { canonicalComponentStatus, canonicalLicenseStatus, type CanonicalLicenseStatus } from './license-status';

export type LicenseStatus = 'pending' | 'active' | 'suspended' | 'revoked' | 'expired';
export type InstallationStatus = 'active' | 'released';

const ORBITFS_COMPONENT_IDS=['orbitfs_base','orbitfs_mcp','orbitfs_apex','orbitfs_studio'] as const;

function runtimeComponentStates(licenseComponent:string,entitlements:Record<string,unknown>,licenseStatus:CanonicalLicenseStatus){
  const out:Record<string,{state:CanonicalLicenseStatus|'not_entitled';allowed:boolean;lockedToThisInstallation:boolean;reason:string|null}>={};
  for(const id of ORBITFS_COMPONENT_IDS){
    const entitled=id===licenseComponent||(licenseComponent==='orbitfs_base'&&(id==='orbitfs_base'||Boolean(entitlements[id])));
    const state=canonicalComponentStatus({licenseStatus,entitled});
    out[id]={
      state,
      allowed:entitled,
      lockedToThisInstallation:entitled&&state==='locked',
      reason:!entitled?'not_included':state==='active'?'activation_required':null
    };
  }
  return out;
}
function hashKey(key: string) { return crypto.createHash('sha256').update(key, 'utf8').digest('hex'); }
export function hashLicenseCredential(key:string){return hashKey(key)}
export function generateLicenseKey() { return `LIC-${crypto.randomBytes(5).toString('hex').toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`; }
export function generateInstallationCredential(){return generateLicenseKey()}

export async function issueLicense(input: { productId: string; customerExternalId?: string | null; customerOverride?: boolean; externalReference?: string | null; expiresAt?: Date | null; actorUserId?: string | null; actor?: string; metadata?: Record<string, unknown> }) {
  const pool=db();
  const client=await pool.connect();
  try{
  await client.query('BEGIN');
  // Serialize check-and-create for a customer's Base license or an override reference.
  const lockIdentity=input.customerExternalId&&!input.customerOverride?`customer:${input.productId}:${input.customerExternalId}`:input.externalReference?`reference:${input.externalReference}`:`unique:${crypto.randomUUID()}`;
  await client.query('select pg_advisory_xact_lock(hashtext($1))',[lockIdentity]);
  const state=(await client.query('select system_enabled,licensing_enabled,maintenance_mode from system_settings where id=true')).rows[0];
  if(!state?.system_enabled||!state.licensing_enabled||state.maintenance_mode) throw new Error('License authority is offline');
  // OrbitFS uses one Base licence per customer. APEX, MCP and Studio are
  // component entitlements on that Base licence, never standalone licence rows.
  const productRow=(await client.query('select slug,status from products where id=$1 limit 1',[input.productId])).rows[0];
  if(!productRow||productRow.status!=='active')throw new Error('Product is unavailable for licence issuance');
  if(productRow.slug!=='orbitfs_base')throw new Error('OrbitFS add-ons are component entitlements on the Base license and cannot be issued as standalone licenses');

  // Normal customer issuance keeps one current license per product. Explicit
  // staff/admin override rows are independent license sets and may coexist.
  if(input.customerExternalId&&!input.customerOverride){
    const existingCurrent=(await client.query(`select l.id,l.status,l.expires_at,l.license_key_last4,l.customer_external_id,l.customer_override,l.metadata,p.slug product from licenses l join products p on p.id=l.product_id where p.id=$1 and l.customer_external_id=$2 and l.customer_override=false and l.status not in ('revoked','expired') and (l.expires_at is null or l.expires_at>now()) order by l.created_at desc limit 1`,[input.productId,String(input.customerExternalId)])).rows[0];
    if(existingCurrent){
      if(existingCurrent.status!=='active')throw new Error('Existing customer license is not active; issuance requires administrative resolution');
      if(input.externalReference){
        const used=(await client.query('select id,customer_external_id from licenses where external_reference=$1 order by created_at desc limit 1',[String(input.externalReference)])).rows[0];
        if(used&&String(used.customer_external_id)!==String(input.customerExternalId))throw new Error('External reference belongs to another customer');
      }
      await client.query('COMMIT');return {...existingCurrent,key:undefined,alreadyIssued:true};
    }
  }
  if(input.externalReference){
    const existing=(await client.query(`select l.id,l.status,l.expires_at,l.license_key_last4,l.customer_external_id,l.customer_override,p.slug product from licenses l join products p on p.id=l.product_id where l.external_reference=$1 and l.status not in ('revoked','expired') order by l.created_at desc limit 1`,[String(input.externalReference)])).rows[0];
    if(existing){
      if(existing.status!=='active')throw new Error('Existing order reference points to an inactive license');
      if(input.customerExternalId&&String(existing.customer_external_id)!==String(input.customerExternalId))throw new Error('External reference belongs to another customer');
      await client.query('COMMIT');return {...existing,key:undefined,alreadyIssued:true};
    }
  }
  const key=generateLicenseKey();const hash=hashKey(key);
  const suppliedMetadata=input.metadata&&typeof input.metadata==='object'?input.metadata:{};
  const suppliedPolicy=(suppliedMetadata as any).license_policy&&typeof (suppliedMetadata as any).license_policy==='object'?(suppliedMetadata as any).license_policy:{};
  const metadata={...suppliedMetadata,license_policy:{...suppliedPolicy,max_installations:1}};
  const result=await client.query(`insert into licenses(license_key_hash,license_key_last4,product_id,customer_external_id,customer_override,external_reference,expires_at,metadata) values($1,$2,$3,$4,$5,$6,$7,$8) returning id,status,issued_at,expires_at,customer_external_id,customer_override`,[hash,key.slice(-4),input.productId,input.customerExternalId??null,Boolean(input.customerOverride),input.externalReference??null,input.expiresAt??null,JSON.stringify(metadata)]);
  const license=result.rows[0];
  await client.query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'license.issue','license',$3,$4)`,[input.actorUserId??null,input.actor??'system',license.id,JSON.stringify({last4:key.slice(-4),product_id:input.productId,customer_external_id:input.customerExternalId??null,customer_override:Boolean(input.customerOverride)})]);
  await client.query('COMMIT');
  return {...license,key,alreadyIssued:false};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
}

export async function validateLicense(input:{key:string;productSlug:string;componentSlug?:string;installationId?:string;productVersion?:string;metadata?:Record<string,unknown>;requestIp?:string|null;userAgent?:string|null;telemetry?:Record<string,unknown>;action?:string}){
  const pool=db();const state=(await pool.query('select system_enabled,licensing_enabled,maintenance_mode,validation_ttl_seconds,offline_grace_seconds,pulse_poll_seconds,max_failed_validations,allow_offline_grace,pulse_revision,pulse_at,pulse_reason from system_settings where id=true')).rows[0];
  const authority_reason=!state?.system_enabled?'manual_shutdown':!state?.licensing_enabled?'licensing_disabled':state?.maintenance_mode?'maintenance':null;
  const runtime_policy={validation_ttl_seconds:Number(state?.validation_ttl_seconds||5400),offline_grace_seconds:Number(state?.offline_grace_seconds||0),pulse_poll_seconds:Number(state?.pulse_poll_seconds||5400),max_failed_validations:Number(state?.max_failed_validations||3),allow_offline_grace:Boolean(state?.allow_offline_grace),pulse_revision:Number(state?.pulse_revision||0),pulse_at:state?.pulse_at??null,pulse_reason:state?.pulse_reason??null,provider_outage_freeze_enabled:true,manual_authority_offline_uses_grace:true,freeze_grace_on_provider_failure:true,freeze_failure_counter_on_provider_failure:true,authority_reason};
  if(authority_reason)return{valid:false,code:'AUTHORITY_UNAVAILABLE' as const,status:503,runtime_policy,authority_reason,provider_outage:false,grace_action:'normal' as const,failure_counter_action:'normal' as const};
  const componentSlug=input.componentSlug==='orbitfs'?'orbitfs_base':input.componentSlug|| (input.productSlug==='orbitfs'?'orbitfs_base':input.productSlug);
  const validProducts=new Set(['orbitfs','orbitfs_base','orbitfs_apex','orbitfs_mcp','orbitfs_studio']);
  const validComponents=new Set(['orbitfs_base','orbitfs_apex','orbitfs_mcp','orbitfs_studio']);
  if(!validProducts.has(input.productSlug)||!validComponents.has(componentSlug)||(input.productSlug!=='orbitfs'&&input.productSlug!=='orbitfs_base'&&input.productSlug!==componentSlug))return{valid:false,code:'LICENSE_NOT_FOUND' as const,status:404,runtime_policy};
  if(!input.installationId)return{valid:false,code:'INSTALLATION_ID_REQUIRED' as const,status:400,runtime_policy};
  const credentialHash=hashKey(input.key);
  let result=await pool.query(`select l.id,l.status,l.expires_at,l.metadata,p.slug component,p.status product_status,false as credential_scoped from licenses l join products p on p.id=l.product_id where l.license_key_hash=$1 and p.slug like 'orbitfs_%' limit 1`,[credentialHash]);
  if(!result.rowCount&&input.installationId){
    result=await pool.query(`select l.id,l.status,l.expires_at,l.metadata,p.slug component,p.status product_status,true as credential_scoped,a.status credential_activation_status from activations a join licenses l on l.id=a.license_id join products p on p.id=l.product_id where a.installation_id=$1 and a.metadata->>'runtime_credential_hash'=$2 and p.slug like 'orbitfs_%' limit 1`,[input.installationId,credentialHash]);
  }
  if(!result.rowCount)return{valid:false,code:'LICENSE_NOT_FOUND' as const,status:404,runtime_policy};
  const license=result.rows[0];
  if(license.credential_scoped===true&&license.credential_activation_status!=='active')return{valid:false,code:'INSTALLATION_RELEASED' as const,status:403,runtime_policy};
  const policy=license.metadata&&typeof license.metadata==='object'&&license.metadata.license_policy&&typeof license.metadata.license_policy==='object'?license.metadata.license_policy:{};
  const entitledComponents=policy.components&&typeof policy.components==='object'?policy.components:{};
  const validationAction=String(input.action||'validate').trim().toLowerCase();
  const componentAllowed=license.component===componentSlug||(license.component==='orbitfs_base'&&componentSlug.startsWith('orbitfs_')&&Boolean(entitledComponents[componentSlug]));
  const expired=Boolean(license.expires_at&&new Date(license.expires_at).getTime()<=Date.now());
  const licenseEligible=license.product_status==='active'&&license.status==='active'&&!expired;
  const validLicense=licenseEligible&&componentAllowed;
  if(expired&&license.status==='active')await pool.query(`update licenses set status='expired' where id=$1 and status='active'`,[license.id]);

  let installationValid=true;
  let bindingLocked=false;
  let bindingStatus='unregistered';
  if(input.installationId){
    const currentActivation=(await pool.query('select id,status from activations where license_id=$1 and installation_id=$2 limit 1',[license.id,input.installationId])).rows[0];
    bindingLocked=currentActivation?.status==='active';
    bindingStatus=String(currentActivation?.status||'unregistered');
  }

  const rotationRequired=license.metadata&&typeof license.metadata==='object'&&license.metadata.base_reinstall_rotation_required&&typeof license.metadata.base_reinstall_rotation_required==='object'?license.metadata.base_reinstall_rotation_required:null;
  if(rotationRequired&&licenseEligible){
    const components=runtimeComponentStates(String(license.component),entitledComponents,canonicalLicenseStatus({storageStatus:license.status,metadata:license.metadata,activationStatuses:[]}));
    return{valid:false,code:'LICENSE_ROTATION_REQUIRED' as const,status:409,expires_at:license.expires_at??null,metadata:license.metadata??{},license_id:license.id,license_status:canonicalLicenseStatus({storageStatus:license.status,metadata:license.metadata,activationStatuses:[]}),runtime_policy,components,installation:{installation_id:input.installationId||null,status:bindingStatus,locked:false}};
  }

  if(validLicense&&input.installationId){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query('select pg_advisory_xact_lock(hashtext($1))',[String(license.id)]);
      const own=(await client.query('select id,status from activations where license_id=$1 and installation_id=$2 limit 1 for update',[license.id,input.installationId])).rows[0];
      const reserved=(await client.query(`select installation_id,status from activations where license_id=$1 and installation_id<>$2 and status='active' order by last_seen_at desc limit 1`,[license.id,input.installationId])).rows[0];
      if(reserved){
        await client.query('ROLLBACK');
        const components=runtimeComponentStates(String(license.component),entitledComponents,canonicalLicenseStatus({storageStatus:license.status,metadata:license.metadata,activationStatuses:[]}));
        return{valid:false,code:'INSTALLATION_LIMIT_REACHED' as const,status:403,expires_at:license.expires_at??null,metadata:license.metadata??{},license_id:license.id,license_status:canonicalLicenseStatus({storageStatus:license.status,metadata:license.metadata,activationStatuses:[]}),runtime_policy,components,installation:{installation_id:input.installationId,status:own?.status||'unregistered',locked:false}};
      }
      if(own?.status==='released'&&validationAction!=='activate'){
        await client.query('ROLLBACK');
        const components=runtimeComponentStates(String(license.component),entitledComponents,canonicalLicenseStatus({storageStatus:license.status,metadata:license.metadata,activationStatuses:[]}));
        return{valid:false,code:'INSTALLATION_RELEASED' as const,status:403,expires_at:license.expires_at??null,metadata:license.metadata??{},license_id:license.id,license_status:canonicalLicenseStatus({storageStatus:license.status,metadata:license.metadata,activationStatuses:[]}),runtime_policy,components,installation:{installation_id:input.installationId,status:'released',locked:false}};
      }
      const t=input.telemetry&&typeof input.telemetry==='object'?input.telemetry:{};
      await client.query(`insert into activations(license_id,installation_id,product_version,status,metadata,last_ip,last_user_agent,last_hostname,last_platform,last_architecture,last_client,last_client_version,last_provider,last_region,current_components) values($1,$2,$3,'active',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict(license_id,installation_id) do update set status='active',last_seen_at=now(),product_version=coalesce(excluded.product_version,activations.product_version),metadata=coalesce(activations.metadata,'{}'::jsonb)||excluded.metadata,last_ip=coalesce(excluded.last_ip,activations.last_ip),last_user_agent=coalesce(excluded.last_user_agent,activations.last_user_agent),last_hostname=coalesce(excluded.last_hostname,activations.last_hostname),last_platform=coalesce(excluded.last_platform,activations.last_platform),last_architecture=coalesce(excluded.last_architecture,activations.last_architecture),last_client=coalesce(excluded.last_client,activations.last_client),last_client_version=coalesce(excluded.last_client_version,activations.last_client_version),last_provider=coalesce(excluded.last_provider,activations.last_provider),last_region=coalesce(excluded.last_region,activations.last_region),current_components=case when excluded.current_components<>'{}'::jsonb then excluded.current_components else activations.current_components end`,[license.id,input.installationId,input.productVersion??null,JSON.stringify(input.metadata??{}),input.requestIp??null,input.userAgent??null,t.hostname?t.hostname:null,t.platform?t.platform:null,t.architecture?t.architecture:null,t.client?t.client:null,t.clientVersion?t.clientVersion:null,t.provider?t.provider:null,t.region?t.region:null,t.components&&typeof t.components==='object'?JSON.stringify(t.components):'{}']);
      bindingLocked=true;
      bindingStatus='active';
      await client.query('COMMIT');
    }catch(error){
      try{await client.query('ROLLBACK')}catch{}
      throw error;
    }finally{client.release()}
  }

  const valid=validLicense&&installationValid;
  const effectiveStatus=canonicalLicenseStatus({storageStatus:license.status,metadata:license.metadata,activationStatuses:bindingLocked?['active']:[]});
  const code=valid?'LICENSE_VALID':!componentAllowed?'COMPONENT_NOT_ENTITLED':!installationValid?'INSTALLATION_NOT_AVAILABLE':expired?'LICENSE_EXPIRED':license.product_status!=='active'?'PRODUCT_DISABLED':effectiveStatus==='terminated'?'LICENSE_TERMINATED':effectiveStatus==='restricted'?'LICENSE_RESTRICTED':effectiveStatus==='suspended'?'LICENSE_SUSPENDED':`LICENSE_${effectiveStatus.toUpperCase()}`;
  const components=runtimeComponentStates(String(license.component),entitledComponents,effectiveStatus);
  return{valid,code,status:valid?200:403,expires_at:license.expires_at??null,metadata:license.metadata??{},license_id:license.id,license_status:effectiveStatus,runtime_policy,components,installation:{installation_id:input.installationId||null,status:bindingStatus,locked:bindingLocked}};
}

export async function deleteLicense(id:string,actorUserId?:string|null,actor?:string){
  const pool=db(); const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const current=(await client.query('select id,customer_external_id,product_id,status from licenses where id=$1 for update',[id])).rows[0];
    if(!current) throw new Error('License not found');
    await client.query('delete from licenses where id=$1',[id]);
    await client.query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'license.delete','license',$3,$4)`,[actorUserId??null,actor??'system',id,JSON.stringify({customer_external_id:current.customer_external_id,product_id:current.product_id,status:current.status,key_destroyed:true})]);
    await client.query('COMMIT'); await sendPulse(actorUserId??null,actor??'system','license-deleted',{license_id:id}); return {id,deleted:true};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export async function setLicenseStatus(id:string,status:LicenseStatus,actorUserId?:string|null,actor?:string,options?:{enforcementScope?:'account'|'license';reason?:string|null}){
  const pool=db();
  const current=(await pool.query('select id,status,metadata from licenses where id=$1 limit 1',[id])).rows[0];
  if(!current)throw new Error('License not found');
  if(current.status==='revoked'&&status==='active')throw new Error('A terminated licence requires manual reactivation with a new key');
  const metadata=current.metadata&&typeof current.metadata==='object'?{...current.metadata}:{};
  if(status==='suspended'){
    metadata.license_enforcement={
      scope:options?.enforcementScope==='account'?'account':'license',
      reason:options?.reason||null,
      changed_at:new Date().toISOString(),
      changed_by:actor??'system'
    };
  }else if(status==='active'){
    delete metadata.license_enforcement;
  }
  const result=(await pool.query(`update licenses set status=$1,metadata=$2 where id=$3 returning id,status,metadata`,[status,JSON.stringify(metadata),id])).rows[0];
  const activationStatuses=(await pool.query('select status from activations where license_id=$1',[id])).rows.map((row:any)=>String(row.status||''));
  const effectiveStatus=canonicalLicenseStatus({storageStatus:result.status,metadata:result.metadata,activationStatuses});
  await pool.query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'license.status','license',$3,$4)`,[actorUserId??null,actor??'system',id,JSON.stringify({status:effectiveStatus,storage_status:result.status,previous_status:current.status,enforcement_scope:options?.enforcementScope||null,reason:options?.reason||null})]);
  const pulse=await sendPulse(actorUserId??null,actor??'system',`license-${effectiveStatus}`,{license_id:id,status:effectiveStatus,storage_status:result.status});
  return {...result,storage_status:result.status,status:effectiveStatus,effective_status:effectiveStatus,pulse};
}

export async function setInstallationStatus(id:string,status:InstallationStatus,actorUserId?:string|null,actor?:string){
  const pool=db();
  const current=(await pool.query('select a.id,a.license_id,a.installation_id,a.status,l.status license_status from activations a join licenses l on l.id=a.license_id where a.id=$1 limit 1',[id])).rows[0];
  if(!current)throw new Error('Installation not found');
  if(current.license_status!=='active')throw new Error('Installation controls are unavailable unless the licence is active');
  if(status==='active'){
    const reserved=(await pool.query("select id from activations where license_id=$1 and id<>$2 and status='active' limit 1",[current.license_id,id])).rows[0];
    if(reserved)throw new Error('This licence is already bound to another installation');
  }
  const result=await pool.query(`update activations set status=$1,last_seen_at=now() where id=$2 returning id,license_id,installation_id,status,last_seen_at`,[status,id]);
  await pool.query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'installation.status','activation',$3,$4)`,[actorUserId??null,actor??'system',id,JSON.stringify({status,previous_status:current.status})]);
  const row=result.rows[0];
  const pulse=await sendPulse(actorUserId??null,actor??'system',`installation-${status}`,{activation_id:id,license_id:row.license_id,installation_id:row.installation_id,status});
  return {...row,pulse};
}

export async function rotateLicense(id:string,actorUserId?:string|null,actor?:string){
  const pool=db();const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const current=(await client.query('select id,status,license_key_last4,metadata from licenses where id=$1 for update',[id])).rows[0];
    if(!current)throw new Error('License not found');
    if(current.status!=='active')throw new Error('Only an active licence can be rotated');
    const key=generateLicenseKey(),previousLast4=current.license_key_last4||null;
    const metadata=current.metadata&&typeof current.metadata==='object'?{...current.metadata}:{};
    const reinstallRotation=metadata.base_reinstall_rotation_required&&typeof metadata.base_reinstall_rotation_required==='object'?metadata.base_reinstall_rotation_required:null;
    if(reinstallRotation){
      const rotatedAt=new Date().toISOString();
      metadata.base_reinstall_last_rotation={...reinstallRotation,rotatedAt,newKeyLast4:key.slice(-4)};
      const reinstallState=metadata.base_reinstall_state&&typeof metadata.base_reinstall_state==='object'?metadata.base_reinstall_state:{};
      metadata.base_reinstall_state={...reinstallState,state:'waiting_new_key',rotationCompletedAt:rotatedAt,newKeyLast4:key.slice(-4),lastError:null};
      delete metadata.base_reinstall_rotation_required;
    }
    const result=(await client.query(`update licenses set license_key_hash=$1,license_key_last4=$2,metadata=$3 where id=$4 returning id,status,expires_at,customer_external_id,customer_override`,[hashKey(key),key.slice(-4),JSON.stringify(metadata),id])).rows[0];
    await client.query("update activations set status='released',last_seen_at=now() where license_id=$1 and status='active'",[id]);
    await client.query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'license.rotate','license',$3,$4)`,[actorUserId??null,actor??'system',id,JSON.stringify({previous_last4:previousLast4,rotated_in_place:true,binding_released:true,base_reinstall_rotation_completed:Boolean(reinstallRotation)})]);
    await client.query('COMMIT');
    const pulse=await sendPulse(actorUserId??null,actor??'system','license-key-rotated',{license_id:id,binding_state:'unlocked'});
    return {...result,storage_status:result.status,status:'active' as const,effective_status:'active' as const,key,alreadyIssued:false,pulse};
  }catch(e){try{await client.query('ROLLBACK')}catch{}throw e;}finally{client.release();}
}

export async function terminateLicense(id:string,actorUserId?:string|null,actor?:string){
  const pool=db();const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const current=(await client.query('select id,status,license_key_last4 from licenses where id=$1 for update',[id])).rows[0];
    if(!current)throw new Error('License not found');
    const burnedHash=hashKey('TERMINATED:'+crypto.randomBytes(32).toString('hex'));
    const result=(await client.query("update licenses set status='revoked',license_key_hash=$1,license_key_last4='DEAD' where id=$2 returning id,status",[burnedHash,id])).rows[0];
    await client.query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'license.terminate','license',$3,$4)`,[actorUserId??null,actor??'system',id,JSON.stringify({previous_status:current.status,previous_last4:current.license_key_last4,key_burned:true})]);
    await client.query('COMMIT');
    const pulse=await sendPulse(actorUserId??null,actor??'system','license-terminated',{license_id:id,key_burned:true});
    return {...result,storage_status:result.status,status:'terminated' as const,effective_status:'terminated' as const,pulse};
  }catch(e){try{await client.query('ROLLBACK')}catch{}throw e;}finally{client.release();}
}

export async function reactivateTerminatedLicense(id:string,actorUserId?:string|null,actor?:string){
  const pool=db();const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const current=(await client.query('select id,status from licenses where id=$1 for update',[id])).rows[0];
    if(!current)throw new Error('License not found');
    if(current.status!=='revoked')throw new Error('Only a terminated licence requires manual reactivation');
    const key=generateLicenseKey();
    const result=(await client.query("update licenses set status='active',license_key_hash=$1,license_key_last4=$2 where id=$3 returning id,status,expires_at,customer_external_id,customer_override",[hashKey(key),key.slice(-4),id])).rows[0];
    await client.query("update activations set status='released',last_seen_at=now() where license_id=$1",[id]);
    await client.query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'license.reactivate','license',$3,$4)`,[actorUserId??null,actor??'system',id,JSON.stringify({new_key_issued:true,binding_state:'unlocked'})]);
    await client.query('COMMIT');
    const pulse=await sendPulse(actorUserId??null,actor??'system','license-reactivated',{license_id:id,binding_state:'unlocked'});
    return {...result,storage_status:result.status,status:'active' as const,effective_status:'active' as const,key,pulse};
  }catch(e){try{await client.query('ROLLBACK')}catch{}throw e;}finally{client.release();}
}

export async function recordInstallationCheckIn(input:{
  licenseId:string;
  installationId:string;
  action:'check_in'|'deploy'|'base_update'|'update'|'redeploy'|'rollback';
  phase:'authorize'|'started'|'completed'|'failed';
  product:string;
  productVersion?:string|null;
  previousVersion?:string|null;
  releaseId?:string|null;
  deploymentId?:string|null;
  deploymentUrl?:string|null;
  projectId?:string|null;
  projectName?:string|null;
  provider?:string|null;
  region?:string|null;
  platform?:string|null;
  architecture?:string|null;
  hostname?:string|null;
  client?:string|null;
  clientVersion?:string|null;
  sourceIp?:string|null;
  userAgent?:string|null;
  customerIdentity?:Record<string,unknown>|null;
  details?:Record<string,unknown>;
}) {
  const pool=db();
  const license=(await pool.query('select id,status,expires_at from licenses where id=$1 limit 1',[input.licenseId])).rows[0];
  if(!license) throw Object.assign(new Error('License not found'),{code:'LICENSE_NOT_FOUND',status:404});
  if(license.status!=='active'||(license.expires_at&&new Date(license.expires_at).getTime()<=Date.now())) throw Object.assign(new Error('License is not active'),{code:'LICENSE_NOT_ELIGIBLE',status:403});
  let activation=(await pool.query('select id,status from activations where license_id=$1 and installation_id=$2 limit 1',[input.licenseId,input.installationId])).rows[0];
  const details=input.details&&typeof input.details==='object'?input.details:{};
  const components=(details.components&&typeof details.components==='object')?details.components:{};
  if(!activation){
    if(input.action==='check_in') throw Object.assign(new Error('Installation is not registered for this license'),{code:'INSTALLATION_NOT_REGISTERED',status:403});
    await pool.query('insert into deployment_events(license_id,activation_id,installation_id,release_id,action,phase,product,product_version,previous_version,deployment_id,deployment_url,project_id,project_name,provider,region,platform,architecture,hostname,client,client_version,source_ip,user_agent,customer_identity,details) values($1,null,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)',[
      input.licenseId,input.installationId,input.releaseId??null,input.action,input.phase,input.product,input.productVersion??null,input.previousVersion??null,input.deploymentId??null,input.deploymentUrl??null,input.projectId??null,input.projectName??null,input.provider??null,input.region??null,input.platform??null,input.architecture??null,input.hostname??null,input.client??null,input.clientVersion??null,input.sourceIp??null,input.userAgent??null,JSON.stringify(input.customerIdentity??{}),JSON.stringify({...details,activationPending:true})
    ]);
    return {ok:true,activationId:null,installationId:input.installationId,activationPending:true};
  }
  if(activation.status!=='active') throw Object.assign(new Error('Installation binding has been released'),{code:'INSTALLATION_RELEASED',status:403});
  await pool.query('insert into deployment_events(license_id,activation_id,installation_id,release_id,action,phase,product,product_version,previous_version,deployment_id,deployment_url,project_id,project_name,provider,region,platform,architecture,hostname,client,client_version,source_ip,user_agent,customer_identity,details) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)',[
    input.licenseId,activation.id,input.installationId,input.releaseId??null,input.action,input.phase,input.product,input.productVersion??null,input.previousVersion??null,input.deploymentId??null,input.deploymentUrl??null,input.projectId??null,input.projectName??null,input.provider??null,input.region??null,input.platform??null,input.architecture??null,input.hostname??null,input.client??null,input.clientVersion??null,input.sourceIp??null,input.userAgent??null,JSON.stringify(input.customerIdentity??{}),JSON.stringify(details)
  ]);
  await pool.query(`update activations set last_seen_at=now(),last_ip=coalesce($2,last_ip),last_user_agent=coalesce($3,last_user_agent),last_hostname=coalesce($4,last_hostname),last_platform=coalesce($5,last_platform),last_architecture=coalesce($6,last_architecture),last_client=coalesce($7,last_client),last_client_version=coalesce($8,last_client_version),last_provider=coalesce($9,last_provider),last_region=coalesce($10,last_region),last_deployment_id=coalesce($11,last_deployment_id),last_deployment_url=coalesce($12,last_deployment_url),last_deployment_status=case when $19=true then last_deployment_status else $13 end,last_operation=$14,product_version=case when $16=true then coalesce($15,product_version) else product_version end,deployment_count=deployment_count+case when $16=true then 1 else 0 end,current_components=case when $17::jsonb<>'{}'::jsonb then $17::jsonb else current_components end,metadata=coalesce(metadata,'{}'::jsonb)||$18::jsonb where id=$1`,[activation.id,input.sourceIp??null,input.userAgent??null,input.hostname??null,input.platform??null,input.architecture??null,input.client??null,input.clientVersion??null,input.provider??null,input.region??null,input.deploymentId??null,input.deploymentUrl??null,input.phase,input.action,input.productVersion??null,input.phase==='completed',JSON.stringify(components),JSON.stringify(details),(input.phase==='failed'&&(input.action==='update'||(input.action==='rollback'&&details.rollbackScope==='update')))]);
  return {ok:true,activationId:activation.id,installationId:input.installationId};
}
