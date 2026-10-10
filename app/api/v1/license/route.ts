import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../lib/auth';
import {issueLicense} from '../../../../lib/core/licenses';
import {db} from '../../../../lib/db';
import {canonicalComponentStatus,canonicalLicenseStatus} from '../../../../lib/core/license-status';
import {buildLicenseScopeFilter} from '../../../../lib/core/license-query-filter.mjs';

export async function GET(request:Request){
  const auth=await integrationAuthorized(request,'license.manage');
  if(!auth)return NextResponse.json({error:'UNAUTHORIZED',code:'UNAUTHORIZED'},{status:401});
  const url=new URL(request.url);
  const customerExternalId=String(url.searchParams.get('customer_external_id')||'').trim();
  const requestedLicenseIds=[...new Set(String(url.searchParams.get('license_ids')||'').split(',').map(value=>value.trim()).filter(value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))].slice(0,100);
  const {params,where}=buildLicenseScopeFilter(customerExternalId,requestedLicenseIds);
  const rows=(await db().query("select l.id,l.license_key_last4,l.product_id,l.customer_external_id,l.external_reference,l.status,l.issued_at,l.expires_at,l.metadata,l.customer_override,p.slug product_code,p.name product from licenses l join products p on p.id=l.product_id"+where+" order by l.issued_at desc",params)).rows;
  const ids=rows.map((row:any)=>String(row.id)).filter(Boolean);
  const activations=ids.length?(await db().query("select id,license_id,installation_id,status,product_version,first_seen_at,last_seen_at,last_provider,last_region,last_platform,last_architecture,last_client,last_client_version,last_deployment_id,last_deployment_url,last_deployment_status,last_operation,deployment_count,current_components from activations where license_id=any($1::uuid[]) order by last_seen_at desc nulls last",[ids])).rows:[];
  const grouped=new Map<string,any[]>();
  for(const activation of activations){const key=String(activation.license_id);const list=grouped.get(key)||[];list.push(activation);grouped.set(key,list);}
  const settings=(await db().query('select system_enabled,licensing_enabled,maintenance_mode,customer_self_unlock_enabled from system_settings where id=true')).rows[0];
  const customerSelfUnlockEffective=Boolean(settings?.system_enabled)&&Boolean(settings?.licensing_enabled)&&!Boolean(settings?.maintenance_mode)&&Boolean(settings?.customer_self_unlock_enabled);
  return NextResponse.json({customer_self_unlock_enabled:customerSelfUnlockEffective,licenses:rows.map((row:any)=>{
    const licenseActivations=grouped.get(String(row.id))||[];
    const effectiveStatus=canonicalLicenseStatus({storageStatus:row.status,metadata:row.metadata,activationStatuses:licenseActivations.map((activation:any)=>activation.status)});
    const entitlements=row?.metadata?.license_policy?.components||{};
    const component_states=Object.fromEntries(['orbitfs_base','orbitfs_apex','orbitfs_mcp','orbitfs_studio'].map(component=>{
      const entitled=component==='orbitfs_base'||Boolean(entitlements[component]);
      return [component,{status:canonicalComponentStatus({licenseStatus:effectiveStatus,entitled}),entitled}];
    }));
    return {
      ...row,
      storage_status:row.status,
      status:effectiveStatus,
      effective_status:effectiveStatus,
      canonical_status:effectiveStatus,
      components:entitlements,
      component_states,
      max_installations:1,
      activations:licenseActivations
    };
  })});
}

export async function POST(request:Request){
  const auth=await integrationAuthorized(request,'license.issue');
  if(!auth)return NextResponse.json({error:'UNAUTHORIZED',code:'UNAUTHORIZED'},{status:401});
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body))return NextResponse.json({error:'Invalid request body',code:'INVALID_REQUEST'},{status:400});
  const productId=String(body?.product_id||'').trim();
  const productSlug=String(body?.product||body?.product_code||body?.productCode||'').trim().toLowerCase();
  if(!productId&&!productSlug)return NextResponse.json({error:'product is required',code:'PRODUCT_REQUIRED'},{status:400});
  const settings=(await db().query('select system_enabled,licensing_enabled,maintenance_mode from system_settings where id=true')).rows[0];
  if(!settings?.system_enabled||!settings?.licensing_enabled||settings.maintenance_mode)return NextResponse.json({error:'License authority unavailable',code:'LICENSE_AUTHORITY_UNAVAILABLE'},{status:503});
  const product=(await db().query(productId?"select id from products where id=$1 and status='active'":"select id from products where slug=$1 and status='active'",[productId||productSlug])).rows[0];
  if(!product)return NextResponse.json({error:'Product not found or disabled',code:'PRODUCT_NOT_FOUND'},{status:404});
  try{
    const customerExternalId=body?.customer_external_id??body?.customerRef??null;
    // API clients must never self-assign an administrative/customer override.
    if(body?.customer_override===true||body?.customerOverride===true||String(customerExternalId||'').trim().toUpperCase()==='ADMIN')
      return NextResponse.json({error:'Customer override is not available through the issuance API',code:'CUSTOMER_OVERRIDE_FORBIDDEN'},{status:403});
    const customerOverride=false;
    if(typeof customerExternalId!=='string'||!customerExternalId.trim()||customerExternalId.length>200)
      return NextResponse.json({error:'A valid customer_external_id is required',code:'CUSTOMER_REQUIRED'},{status:400});
    const reference=body?.external_reference??body?.orderRef??null;
    if(typeof reference!=='string'||!reference.trim()||reference.length>256)
      return NextResponse.json({error:'A valid external_reference is required',code:'ORDER_REFERENCE_REQUIRED'},{status:400});
    const rawExpiry=body?.expires_at??body?.expiresAt??null;
    const expiresAt=rawExpiry?new Date(String(rawExpiry)):null;
    if(expiresAt&&Number.isNaN(expiresAt.getTime()))return NextResponse.json({error:'Invalid expiry date',code:'INVALID_EXPIRY'},{status:400});
    const suppliedMetadata=body?.metadata&&typeof body.metadata==='object'?body.metadata:{};const components=body?.components&&typeof body.components==='object'?body.components:null;const existingPolicy=(suppliedMetadata as any).license_policy&&typeof (suppliedMetadata as any).license_policy==='object'?(suppliedMetadata as any).license_policy:{};const metadata={...suppliedMetadata,license_policy:{...existingPolicy,max_installations:1,...(components?{components}:{})}};const result=await issueLicense({productId:product.id,customerExternalId,customerOverride,externalReference:reference.trim(),expiresAt,actor:`api:${auth.name}`,metadata});
    const authorityRow=(await db().query('select status,metadata from licenses where id=$1 limit 1',[result.id])).rows[0]||{status:result.status,metadata};
    const activationStatuses=(await db().query('select status from activations where license_id=$1',[result.id])).rows.map((row:any)=>String(row.status||''));
    const effectiveStatus=canonicalLicenseStatus({storageStatus:authorityRow.status,metadata:authorityRow.metadata,activationStatuses});
    const license={id:result.id,license_key:result.key,license_id:result.id,status:effectiveStatus,storage_status:authorityRow.status,effective_status:effectiveStatus,canonical_status:effectiveStatus,issued_at:result.issued_at,expires_at:result.expires_at,customer_external_id:result.customer_external_id,customer_override:result.customer_override,already_issued:Boolean((result as any).alreadyIssued)};
    return NextResponse.json({...license,license});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to issue license',code:'LICENSE_ISSUE_FAILED'},{status:500});}
}