import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../../../lib/auth';
import {validateLicense} from '../../../../../../lib/core/licenses';
import {CUSTOMER_DATABASE_COMPONENTS,getCurrentDatabasePackage,type CustomerDatabaseComponent} from '../../../../../../lib/core/database-packages';

export const runtime='nodejs';

function requestIp(request:Request){return request.headers.get('x-real-ip')?.trim()||request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||null;}
function entitlementKey(component:CustomerDatabaseComponent){return component==='base'?'orbitfs_base':component==='engine-shared'?null:'orbitfs_'+component;}

export async function GET(request:Request,{params}:{params:Promise<{key:string}>}){
  const {key:raw}=await params;
  const component=String(raw||'').trim().toLowerCase() as CustomerDatabaseComponent;
  if(!CUSTOMER_DATABASE_COMPONENTS.includes(component))return NextResponse.json({ok:false,code:'DATABASE_PACKAGE_COMPONENT_INVALID'},{status:400});

  const licenseKey=request.headers.get('x-license-key')?.trim()||'';
  if(!licenseKey){
    const auth=await integrationAuthorized(request,'database.packages.read');
    if(!auth)return NextResponse.json({ok:false,code:'LICENSE_KEY_REQUIRED'},{status:401});
  }else{
    const installationId=request.headers.get('x-installation-id')?.trim()||'';
    const validation:any=await validateLicense({
      key:licenseKey,
      productSlug:'orbitfs_base',
      installationId:installationId||undefined,
      requestIp:requestIp(request),
      userAgent:request.headers.get('user-agent'),
      telemetry:{client:request.headers.get('x-orbitfs-client')||'orbitfs-database-deployer'}
    });
    if(!validation.valid)return NextResponse.json({ok:false,code:validation.code},{status:validation.status});
    const states=validation.components&&typeof validation.components==='object'?validation.components:{};
    if(component==='engine-shared'){
      const allowed=['orbitfs_mcp','orbitfs_apex','orbitfs_studio'].some(key=>Boolean(states[key]?.allowed));
      if(!allowed)return NextResponse.json({ok:false,code:'DATABASE_PACKAGE_COMPONENT_NOT_ENTITLED'},{status:403});
    }else{
      const key=entitlementKey(component);
      if(key&&!states[key]?.allowed)return NextResponse.json({ok:false,code:'DATABASE_PACKAGE_COMPONENT_NOT_ENTITLED'},{status:403});
    }
  }

  const requestedSourceRepo=request.headers.get('x-orbitfs-source-repo')?.trim()||null;
  let row:any;
  try{row=await getCurrentDatabasePackage(component,requestedSourceRepo)}catch(error:any){
    const code=String(error?.message||'DATABASE_PACKAGE_SOURCE_REPO_INVALID');
    return NextResponse.json({ok:false,code},{status:400});
  }
  if(!row)return NextResponse.json({ok:false,code:'DATABASE_PACKAGE_NOT_FOUND'},{status:404});
  return NextResponse.json({
    ok:true,
    authority:'orbitfs-license-master-v2',
    package:{
      id:row.id,
      component:row.component,
      databaseTarget:row.database_target,
      sourceRepo:row.source_repo,
      sourceCommit:row.source_commit,
      databaseSchemaVersion:row.database_schema_version,
      minimumBaseSchemaVersion:row.minimum_base_schema_version,
      minimumBaseVersion:row.minimum_base_version,
      sha256:row.package_sha256,
      publishedAt:row.published_at,
      payload:row.package
    }
  },{headers:{'cache-control':'private, no-store'}});
}
