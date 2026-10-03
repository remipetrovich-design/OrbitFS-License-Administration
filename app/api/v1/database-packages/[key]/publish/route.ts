import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../../../lib/auth';
import {publishDatabasePackage} from '../../../../../../lib/core/database-packages';

export const runtime='nodejs';

export async function POST(request:Request,{params}:{params:Promise<{key:string}>}){
  const auth=await integrationAuthorized(request,'database.packages.control');
  if(!auth)return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});
  const {key:id}=await params;
  try{
    const row=await publishDatabasePackage(id,`api:${auth.name}`);
    return NextResponse.json({ok:true,package:{id:row.id,component:row.component,databaseSchemaVersion:row.database_schema_version,sha256:row.package_sha256,sourceCommit:row.source_commit,status:row.status,publishedAt:row.published_at}});
  }catch(error:any){
    const code=String(error?.message||'DATABASE_PACKAGE_PUBLISH_FAILED');
    return NextResponse.json({ok:false,code},{status:code==='DATABASE_PACKAGE_NOT_FOUND'?404:409});
  }
}
