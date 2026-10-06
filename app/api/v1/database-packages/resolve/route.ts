import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../../lib/auth';
import {CUSTOMER_DATABASE_COMPONENTS,resolveDatabasePackageSetForRelease,type CustomerDatabaseComponent} from '../../../../../lib/core/database-packages';

export const runtime='nodejs';

function parseComponents(value:string|null){
  const requested=[...new Set(String(value||'').split(',').map((item)=>item.trim().toLowerCase()).filter(Boolean))];
  if(!requested.length)throw new Error('DATABASE_PACKAGE_COMPONENTS_REQUIRED');
  for(const item of requested){
    if(!CUSTOMER_DATABASE_COMPONENTS.includes(item as CustomerDatabaseComponent)){
      throw new Error('DATABASE_PACKAGE_COMPONENT_INVALID:'+item);
    }
  }
  return requested;
}

export async function GET(request:Request){
  const auth=await integrationAuthorized(request,'database.packages.read');
  if(!auth)return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});

  try{
    const url=new URL(request.url);
    const components=parseComponents(url.searchParams.get('components'));
    const includePayload=url.searchParams.get('include_payload')==='true';
    const rows=await resolveDatabasePackageSetForRelease(components);
    const packages=rows.map((row:any)=>({
      id:row.id,
      component:row.component,
      databaseTarget:row.database_target,
      sourceRepo:row.source_repo,
      sourceCommit:row.source_commit,
      databaseSchemaVersion:row.database_schema_version,
      minimumBaseSchemaVersion:null,
      minimumBaseVersion:null,
      sha256:row.package_sha256,
      status:row.status,
      resolutionSource:row.resolution_source||'unknown',
      createdAt:row.created_at,
      publishedAt:row.published_at,
      ...(includePayload?{payload:row.package}:{})
    }));
    return NextResponse.json({
      ok:true,
      authority:'orbitfs-license-master-v2',
      sourcePreference:'master-database-system',
      packages
    },{headers:{'cache-control':'private, no-store'}});
  }catch(error:any){
    return NextResponse.json({ok:false,code:String(error?.message||'DATABASE_PACKAGE_RESOLVE_FAILED')},{status:400});
  }
}
