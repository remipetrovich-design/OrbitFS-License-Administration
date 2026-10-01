import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../lib/auth';
import {createDatabasePackageCandidate,listDatabasePackages} from '../../../../lib/core/database-packages';

export const runtime='nodejs';

export async function GET(request:Request){
  const auth=await integrationAuthorized(request,'database.packages.read');
  if(!auth)return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});
  try{
    const url=new URL(request.url);
    const component=url.searchParams.get('component')||undefined;
    const packages=await listDatabasePackages(component);
    return NextResponse.json({ok:true,packages});
  }catch(error:any){
    return NextResponse.json({ok:false,code:String(error?.message||'DATABASE_PACKAGE_LIST_FAILED')},{status:400});
  }
}

export async function POST(request:Request){
  const auth=await integrationAuthorized(request,'database.packages.write');
  if(!auth)return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});
  const body=await request.json().catch(()=>null);
  if(!body)return NextResponse.json({ok:false,code:'INVALID_REQUEST'},{status:400});
  try{
    const packageData=body.package&&typeof body.package==='object'?body.package:body;
    const row=await createDatabasePackageCandidate(packageData,`api:${auth.name}`);
    return NextResponse.json({ok:true,package:{id:row.id,component:row.component,databaseSchemaVersion:row.database_schema_version,sha256:row.package_sha256,status:row.status,sourceRepo:row.source_repo,sourceCommit:row.source_commit}});
  }catch(error:any){
    return NextResponse.json({ok:false,code:String(error?.message||'DATABASE_PACKAGE_CREATE_FAILED')},{status:400});
  }
}
