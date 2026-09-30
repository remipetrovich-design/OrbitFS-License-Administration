'use server';
import { issueLicense, reactivateTerminatedLicense, rotateLicense, setInstallationStatus, setLicenseStatus, terminateLicense, deleteLicense } from '../../lib/core/licenses';
import { db } from '../../lib/db';
import { sendPulse } from '../../lib/core/settings';
import { requireUser } from '../../lib/session';
import { revalidatePath } from 'next/cache';

const roles=['owner','admin','operator'];
export async function issueLicenseAction(_prev:{ok:boolean,key:string,error:string}, formData:FormData){
  const user=await requireUser();
  if(!roles.includes(user.role)) return {ok:false,key:'',error:'You do not have permission to issue licenses'};
  const productId=String(formData.get('product_id')||'');
  if(!productId) return {ok:false,key:'',error:'Select a product'};
  const product=(await db().query("select id,slug from products where id=$1 and status='active'",[productId])).rows[0];
  if(!product) return {ok:false,key:'',error:'Product not found or disabled'};
  if(product.slug!=='orbitfs_base')return {ok:false,key:'',error:'OrbitFS add-ons are component entitlements on the Base licence'};
  const customer=String(formData.get('customer')||'').trim();
  const customerOverride=customer.toUpperCase()==='ADMIN'||formData.get('customer_override')==='on';
  const expires=String(formData.get('expires')||'');
  let expiresAt:Date|null=null;
  if(expires){expiresAt=new Date(expires);if(Number.isNaN(expiresAt.getTime()))return {ok:false,key:'',error:'Invalid expiry'};}
  try{
    const components={orbitfs_base:true,orbitfs_apex:formData.get('orbitfs_apex')==='on',orbitfs_mcp:formData.get('orbitfs_mcp')==='on',orbitfs_studio:formData.get('orbitfs_studio')==='on'};
    const metadata={...(customerOverride?{issuance_mode:'admin_multiple_license_override'}:{}),license_policy:{max_installations:1,components}};
    const result=await issueLicense({productId,customerExternalId:customer||null,customerOverride,externalReference:String(formData.get('reference')||'')||null,expiresAt,actorUserId:user.id,actor:user.email,metadata});
    revalidatePath('/licenses');
    return {ok:true,key:result.key,error:''};
  }catch(e){return {ok:false,key:'',error:e instanceof Error?e.message:'Unable to issue license'};}
}

export async function rotateLicenseAction(_prev:{ok:boolean,key:string,error:string}, formData:FormData){
  const user=await requireUser();
  if(!roles.includes(user.role)) return {ok:false,key:'',error:'You do not have permission to control licenses'};
  const id=String(formData.get('id')||'');const action=String(formData.get('action')||'');const installationId=String(formData.get('installation_id')||'');
  if(!id)return {ok:false,key:'',error:'License id is required'};
  try{
    if(action==='rotate'){const replacement=await rotateLicense(id,user.id,user.email);return {ok:true,key:replacement.key,error:''};}
    if(action==='suspend'){await setLicenseStatus(id,'suspended',user.id,user.email);return {ok:true,key:'',error:''};}
    if(action==='revoke'||action==='terminate'){await terminateLicense(id,user.id,user.email);return {ok:true,key:'',error:''};}
    if(action==='activate'){
      const current=(await db().query('select status from licenses where id=$1',[id])).rows[0];
      if(current?.status==='revoked'){const replacement=await reactivateTerminatedLicense(id,user.id,user.email);return {ok:true,key:replacement.key,error:''};}
      await setLicenseStatus(id,'active',user.id,user.email);return {ok:true,key:'',error:''};
    }
    if(installationId&&action==='unlock'){
      const activation=(await db().query('select id from activations where id=$1 and license_id=$2',[installationId,id])).rows[0];
      if(activation)await setInstallationStatus(activation.id,'released',user.id,user.email);
    }
    return {ok:true,key:'',error:''};
  }catch(e){return {ok:false,key:'',error:e instanceof Error?e.message:'License control failed'};}
}

export async function licenseControlAction(formData:FormData){
  const user=await requireUser();
  if(!roles.includes(user.role)) return;
  const id=String(formData.get('id')||'');const action=String(formData.get('action')||'');const installationId=String(formData.get('installation_id')||'');
  if(!id)return;
  if(action==='suspend'){await setLicenseStatus(id,'suspended',user.id,user.email);return;}
  if(action==='revoke'||action==='terminate'){await terminateLicense(id,user.id,user.email);return;}
  if(action==='activate'){
    const current=(await db().query('select status from licenses where id=$1',[id])).rows[0];
    if(current?.status==='revoked'){await reactivateTerminatedLicense(id,user.id,user.email);return;}
    await setLicenseStatus(id,'active',user.id,user.email);return;
  }
  if(action==='delete'){await deleteLicense(id,user.id,user.email);return;}
  if(installationId&&action==='unlock'){
    const activation=(await db().query('select id from activations where id=$1 and license_id=$2',[installationId,id])).rows[0];
    if(activation)await setInstallationStatus(activation.id,'released',user.id,user.email);
  }
}


export async function updateLicenseAction(_prev:{ok:boolean,error:string}, formData:FormData){
  const user=await requireUser();
  if(!roles.includes(user.role))return {ok:false,error:'You do not have permission to edit licenses'};
  const id=String(formData.get('id')||'').trim();
  if(!id)return {ok:false,error:'License id is required'};
  try{
    const current=(await db().query(`select l.id,l.customer_external_id,l.external_reference,l.expires_at,l.metadata,l.status,p.slug product from licenses l join products p on p.id=l.product_id where l.id=$1 limit 1`,[id])).rows[0];
    if(!current)return {ok:false,error:'License not found'};
    const customer=String(formData.get('customer_external_id')||formData.get('customer')||'').trim()||null;
    const reference=String(formData.get('external_reference')||formData.get('reference')||'').trim()||null;
    const expires=String(formData.get('expires_at')||formData.get('expires')||'').trim();
    let expiresAt:Date|null=null;
    if(expires){expiresAt=new Date(expires);if(Number.isNaN(expiresAt.getTime()))return {ok:false,error:'Invalid expiry'};}
    const existingPolicy=current.metadata&&typeof current.metadata==='object'&&current.metadata.license_policy&&typeof current.metadata.license_policy==='object'?current.metadata.license_policy:{};
    let components:any=existingPolicy.components&&typeof existingPolicy.components==='object'?{...existingPolicy.components}:{};
    if(current.product==='orbitfs_base'){
      components={
        orbitfs_base:true,
        orbitfs_apex:formData.get('orbitfs_apex')==='on',
        orbitfs_mcp:formData.get('orbitfs_mcp')==='on',
        orbitfs_studio:formData.get('orbitfs_studio')==='on'
      };
    }
    const policy={...existingPolicy,max_installations:1,...(current.product==='orbitfs_base'?{components}:{})};
    const metadata={...(current.metadata||{}),license_policy:policy};
    const updated=(await db().query(`update licenses set customer_external_id=$2,external_reference=$3,expires_at=$4,metadata=$5 where id=$1 returning id,status,customer_external_id,external_reference,expires_at,metadata`,[id,customer,reference,expiresAt,JSON.stringify(metadata)])).rows[0];
    await db().query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'license.update','license',$3,$4)`,[user.id,user.email,id,JSON.stringify({before:{customer_external_id:current.customer_external_id,external_reference:current.external_reference,expires_at:current.expires_at,license_policy:existingPolicy},after:{customer_external_id:customer,external_reference:reference,expires_at:expiresAt,license_policy:policy}})]);
    await sendPulse(user.id,user.email,'license-updated',{license_id:id,customer_external_id:customer,components});
    revalidatePath('/licenses');
    return {ok:true,error:''};
  }catch(e){return {ok:false,error:e instanceof Error?e.message:'Unable to update license'};}
}


export async function licenseFormAction(prev:{ok:boolean,key:string,error:string}, formData:FormData){
  const id=String(formData.get('id')||'').trim();
  if(!id)return issueLicenseAction(prev,formData);
  const updated=await updateLicenseAction({ok:false,error:''},formData);
  return {ok:updated.ok,key:'',error:updated.error};
}
