import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../lib/auth';
import {issueLicense} from '../../../../lib/core/licenses';
import {db} from '../../../../lib/db';

export async function GET(request:Request){
  const auth=await integrationAuthorized(request,'license.manage');
  if(!auth)return NextResponse.json({error:'UNAUTHORIZED',code:'UNAUTHORIZED'},{status:401});
  const rows=(await db().query("select l.id,l.license_key_last4,l.product_id,l.customer_external_id,l.external_reference,l.status,l.issued_at,l.expires_at,l.metadata,l.customer_override,p.slug product_code,p.name product from licenses l join products p on p.id=l.product_id order by l.issued_at desc")).rows;
  const ids=rows.map((row:any)=>String(row.id)).filter(Boolean);
  const activations=ids.length?(await db().query("select id,license_id,installation_id,status,product_version,first_seen_at,last_seen_at,last_provider,last_region,last_platform,last_architecture,last_client,last_client_version,last_deployment_id,last_deployment_url,last_deployment_status,last_operation,deployment_count,current_components from activations where license_id=any($1::uuid[]) order by last_seen_at desc nulls last",[ids])).rows:[];
  const grouped=new Map<string,any[]>();
  for(const activation of activations){const key=String(activation.license_id);const list=grouped.get(key)||[];list.push(activation);grouped.set(key,list);}
  const settings=(await db().query('select customer_self_unlock_enabled from system_settings where id=true')).rows[0];
  return NextResponse.json({customer_self_unlock_enabled:Boolean(settings?.customer_self_unlock_enabled),licenses:rows.map((row:any)=>({
    ...row,
    components:row?.metadata?.license_policy?.components||{},
    max_installations:1,
    activations:grouped.get(String(row.id))||[]
  }))});
}

export async function POST(request:Request){
  const auth=await integrationAuthorized(request,'license.issue');
  if(!auth)return NextResponse.json({error:'UNAUTHORIZED',code:'UNAUTHORIZED'},{status:401});
  const body=await request.json().catch(()=>null);
  const productId=String(body?.product_id||'').trim();
  const productSlug=String(body?.product||body?.product_code||body?.productCode||'').trim().toLowerCase();
  if(!productId&&!productSlug)return NextResponse.json({error:'product is required',code:'PRODUCT_REQUIRED'},{status:400});
  const settings=(await db().query('select system_enabled,licensing_enabled,maintenance_mode from system_settings where id=true')).rows[0];
  if(!settings?.system_enabled||!settings?.licensing_enabled||settings.maintenance_mode)return NextResponse.json({error:'License authority unavailable',code:'LICENSE_AUTHORITY_UNAVAILABLE'},{status:503});
  const product=(await db().query(productId?"select id from products where id=$1 and status='active'":"select id from products where slug=$1 and status='active'",[productId||productSlug])).rows[0];
  if(!product)return NextResponse.json({error:'Product not found or disabled',code:'PRODUCT_NOT_FOUND'},{status:404});
  try{
    const customerExternalId=body?.customer_external_id??body?.customerRef??null;
    const customerOverride=Boolean(body?.customer_override??body?.customerOverride) || String(customerExternalId||'').trim().toUpperCase()==='ADMIN';
    const rawExpiry=body?.expires_at??body?.expiresAt??null;
    const expiresAt=rawExpiry?new Date(String(rawExpiry)):null;
    if(expiresAt&&Number.isNaN(expiresAt.getTime()))return NextResponse.json({error:'Invalid expiry date',code:'INVALID_EXPIRY'},{status:400});
    const suppliedMetadata=body?.metadata&&typeof body.metadata==='object'?body.metadata:{};const components=body?.components&&typeof body.components==='object'?body.components:null;const existingPolicy=(suppliedMetadata as any).license_policy&&typeof (suppliedMetadata as any).license_policy==='object'?(suppliedMetadata as any).license_policy:{};const metadata={...suppliedMetadata,license_policy:{...existingPolicy,max_installations:1,...(components?{components}:{})}};const result=await issueLicense({productId:product.id,customerExternalId,customerOverride,externalReference:body?.external_reference??body?.orderRef??null,expiresAt,actor:`api:${auth.name}`,metadata});
    const license={id:result.id,license_key:result.key,license_id:result.id,status:result.status,issued_at:result.issued_at,expires_at:result.expires_at,customer_external_id:result.customer_external_id,customer_override:result.customer_override,already_issued:Boolean((result as any).alreadyIssued)};
    return NextResponse.json({...license,license});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Unable to issue license',code:'LICENSE_ISSUE_FAILED'},{status:500});}
}