import { db } from '../db';

export async function listReleases(includeArchived=false){
  const sql = includeArchived
    ? 'select * from releases order by created_at desc'
    : "select * from releases where coalesce(status,'') <> 'archived' order by created_at desc";
  return (await db().query(sql)).rows;
}

export async function createRelease(input:{
  productId:string;channel:string;version:string;releaseType:'base'|'update';
  sourceRepo?:string|null;sourceRef?:string|null;sourceSha?:string|null;
  artifactUrl?:string|null;checksum?:string|null;notes?:string|null;
  manifest?:Record<string,unknown>;actor?:string;
}){
  const result=await db().query(
    `insert into releases(product_id,channel,version,release_type,source_repo,source_ref,source_sha,artifact_url,checksum_sha256,notes,manifest,review_status,status,created_by)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'pending','draft',$12)
     returning *`,
    [input.productId,input.channel,input.version,input.releaseType,input.sourceRepo??null,input.sourceRef??null,input.sourceSha??null,input.artifactUrl??null,input.checksum??null,input.notes??null,JSON.stringify(input.manifest||{}),input.actor??'api']
  );
  return result.rows[0];
}

export async function validateRelease(id:string,_unused?:unknown,actor?:string){
  const existing=(await db().query('select * from releases where id=$1 limit 1',[id])).rows[0];
  if(!existing)return null;
  const checks=[
    {name:'identity',status:existing.version&&existing.release_type?'passed':'failed'},
    {name:'checksum',status:existing.checksum_sha256?'passed':'failed'},
  ];
  const status=checks.every(c=>c.status==='passed')?'passed':'failed';
  const manifest={...(existing.manifest||{}),validation:{status,checks,actor:actor??'api'}};
  const row=(await db().query('update releases set manifest=$2::jsonb, updated_at=now() where id=$1 returning *',[id,JSON.stringify(manifest)])).rows[0];
  return row;
}
