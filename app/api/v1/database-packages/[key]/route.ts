import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../../lib/auth';
import {getDatabasePackageById} from '../../../../../lib/core/database-packages';

export const runtime='nodejs';

export async function GET(request:Request,{params}:{params:Promise<{key:string}>}){
  const auth=await integrationAuthorized(request,'database.packages.read');
  if(!auth)return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});
  const {key:id}=await params;
  const row=await getDatabasePackageById(id);
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
      minimumBaseSchemaVersion:null,
      minimumBaseVersion:null,
      sha256:row.package_sha256,
      status:row.status,
      createdAt:row.created_at,
      publishedAt:row.published_at,
      payload:row.package
    }
  },{headers:{'cache-control':'private, no-store'}});
}
