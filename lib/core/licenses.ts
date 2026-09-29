import crypto from 'node:crypto';
import { db } from '../db';

export type LicenseStatus = 'pending' | 'active' | 'suspended' | 'revoked' | 'expired';
export type InstallationStatus = 'active' | 'released';

function hashKey(key: string) { return crypto.createHash('sha256').update(key, 'utf8').digest('hex'); }
export function generateLicenseKey() { return `LIC-${crypto.randomBytes(5).toString('hex').toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`; }

export async function issueLicense(input: { productId: string; customerExternalId?: string | null; customerOverride?: boolean; externalReference?: string | null; expiresAt?: Date | null; actorUserId?: string | null; actor?: string; metadata?: Record<string, unknown> }) {
  const pool=db();
  const state=(await pool.query('select system_enabled,licensing_enabled,maintenance_mode from system_settings where id=true')).rows[0];
  if(!state?.system_enabled||!state.licensing_enabled||state.maintenance_mode) throw new Error('License authority is offline');
  const productRow=(await pool.query('select slug from products where id=$1 limit 1',[input.productId])).rows[0];
  if(productRow && productRow.slug!=='orbitfs_base')throw new Error('OrbitFS add-ons are component entitlements on the Base license and cannot be issued as standalone licenses');
  if(input.customerExternalId&&!input.customerOverride){
    const existingCurrent=(await pool.query(`select l.id,l.status,l.expires_at,l.license_key_last4,l.customer_external_id,l.customer_override,l.metadata,p.slug product from licenses l join products p on p.id=l.product_id where p.id=$1 and l.customer_external_id=$2 and l.customer_override=false and l.status not in ('revoked','expired') order by l.created_at desc limit 1`,[input.productId,String(input.customerExternalId)])).rows[0];
    if(existingCurrent)return {...existingCurrent,key:undefined,alreadyIssued:true};
  }
  if(input.externalReference){
    const existing=(await pool.query(`select l.id,l.status,l.expires_at,l.license_key_last4,l.customer_external_id,l.customer_override,p.slug product from licenses l join products p on p.id=l.product_id where l.external_reference=$1 and l.status not in ('revoked','expired') order by l.created_at desc limit 1`,[String(input.externalReference)])).rows[0];
    if(existing)return {...existing,key:undefined,alreadyIssued:true};
  }
  const key=generateLicenseKey();const hash=hashKey(key);
  const suppliedMetadata=input.metadata&&typeof input.metadata==='object'?input.metadata:{};
  const suppliedPolicy=(suppliedMetadata as any).license_policy&&typeof (suppliedMetadata as any).license_policy==='object'?(suppliedMetadata as any).license_policy:{};
  const metadata={...suppliedMetadata,license_policy:{...suppliedPolicy,max_installations:1}};
  const result=await pool.query(`insert into licenses(license_key_hash,license_key_last4,product_id,customer_external_id,customer_override,external_reference,expires_at,metadata) values($1,$2,$3,$4,$5,$6,$7,$8) returning id,status,expires_at,customer_external_id,customer_override,issued_at`,[hash,key.slice(-4),input.productId,input.customerExternalId??null,Boolean(input.customerOverride),input.externalReference??null,input.expiresAt??null,JSON.stringify(metadata)]);
  const license=result.rows[0];
  await pool.query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'license.issue','license',$3,$4)`,[input.actorUserId??null,input.actor??'system',license.id,JSON.stringify({last4:key.slice(-4),product_id:input.productId})]);
  return {...license,key,alreadyIssued:false};
}

export async function setInstallationStatus(activationId:string,status:InstallationStatus,_actorUserId?:string|null,actor?:string){
  const row=(await db().query(`update activations set status=$2, updated_at=now() where id=$1 returning *`,[activationId,status])).rows[0];
  if(row){
    await db().query(`insert into audit_events(actor,action,resource_type,resource_id,details) values($1,'installation.status','activation',$2,$3)`,[actor??'system',activationId,JSON.stringify({status})]);
  }
  return row;
}
