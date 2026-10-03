import { createHash } from 'node:crypto';
import { db } from '../db';

export const CUSTOMER_DATABASE_COMPONENTS = ['base','engine-shared','mcp','apex','studio'] as const;
export type CustomerDatabaseComponent = typeof CUSTOMER_DATABASE_COMPONENTS[number];

const FORMAT='orbitfs-customer-database-package-v1';
const MAX_MIGRATION_BYTES=2*1024*1024;
const MAX_PACKAGE_BYTES=12*1024*1024;
const FORBIDDEN_INTERNAL_SQL=/\b(?:billing_[a-z0-9_]*|license_manager_[a-z0-9_]*|dev_panel_[a-z0-9_]*|incident_[a-z0-9_]*|deployment_events|license_pulses|license_pulse_receipts|api_keys)\b/i;
const DESTRUCTIVE_SQL=/\b(?:drop\s+table|drop\s+schema|truncate\s+(?:table\s+)?|alter\s+table[\s\S]{0,300}?drop\s+column)\b/i;
const TRANSACTION_SQL=/\b(?:begin|commit|rollback)\s*;/i;

const SOURCE_REPOS:Record<CustomerDatabaseComponent,readonly string[]>={
  base:['remipetrovich-design/OrbitFS-Base-System'],
  'engine-shared':['remipetrovich-design/OrbitFS_Engine'],
  mcp:['remipetrovich-design/OrbitFS_Engine'],
  apex:['remipetrovich-design/OrbitFS_Engine'],
  studio:['remipetrovich-design/OrbitFS_Engine']
};

const MIGRATION_PATHS:Record<CustomerDatabaseComponent,RegExp>={
  base:/^supabase\/migrations\/\d{14}_[A-Za-z0-9._-]+\.sql$/,
  'engine-shared':/^supabase\/migrations\/shared\/\d{14}_[A-Za-z0-9._-]+\.sql$/,
  mcp:/^supabase\/migrations\/mcp\/\d{14}_[A-Za-z0-9._-]+\.sql$/,
  apex:/^supabase\/migrations\/apex\/\d{14}_[A-Za-z0-9._-]+\.sql$/,
  studio:/^supabase\/migrations\/studio\/\d{14}_[A-Za-z0-9._-]+\.sql$/
};

function component(value:unknown):CustomerDatabaseComponent{
  const normalized=String(value||'').trim().toLowerCase();
  if(!CUSTOMER_DATABASE_COMPONENTS.includes(normalized as CustomerDatabaseComponent))throw new Error('DATABASE_PACKAGE_COMPONENT_INVALID');
  return normalized as CustomerDatabaseComponent;
}

function sha256(bytes:Buffer){return createHash('sha256').update(bytes).digest('hex');}
function canonicalJson(value:any):string{
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map((item)=>canonicalJson(item)).join(',')+']';
  return '{'+Object.keys(value).sort().map((key)=>JSON.stringify(key)+':'+canonicalJson(value[key])).join(',')+'}';
}
function canonicalBytes(value:unknown){return Buffer.from(canonicalJson(value),'utf8');}

export function validateDatabasePackage(input:any){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('DATABASE_PACKAGE_INVALID');
  if(String(input.format||'')!==FORMAT||Number(input.packageVersion||0)!==1)throw new Error('DATABASE_PACKAGE_FORMAT_INVALID');

  const selected=component(input.component);
  if(String(input.databaseTarget||'').trim().toLowerCase()!=='customer')throw new Error('DATABASE_PACKAGE_TARGET_INVALID');

  const sourceRepo=String(input.sourceRepo||'').trim();
  if(!SOURCE_REPOS[selected].includes(sourceRepo))throw new Error('DATABASE_PACKAGE_SOURCE_REPO_INVALID');

  const sourceCommit=String(input.sourceCommit||'').trim().toLowerCase();
  if(!/^[a-f0-9]{40}$/.test(sourceCommit))throw new Error('DATABASE_PACKAGE_SOURCE_COMMIT_INVALID');

  const databaseSchemaVersion=Number(input.databaseSchemaVersion);
  if(!Number.isInteger(databaseSchemaVersion)||databaseSchemaVersion<1)throw new Error('DATABASE_PACKAGE_SCHEMA_VERSION_INVALID');

  const minimumBaseSchemaVersion=input.minimumBaseSchemaVersion==null?null:Number(input.minimumBaseSchemaVersion);
  if(minimumBaseSchemaVersion!==null&&(!Number.isInteger(minimumBaseSchemaVersion)||minimumBaseSchemaVersion<1))throw new Error('DATABASE_PACKAGE_MINIMUM_BASE_SCHEMA_INVALID');

  const minimumBaseVersion=input.minimumBaseVersion==null?null:String(input.minimumBaseVersion).trim()||null;
  const migrations=Array.isArray(input.migrations)?input.migrations:[];
  const migrationCount=Number(input.migrationCount);
  if(!Number.isInteger(migrationCount)||migrationCount<0||migrationCount!==migrations.length)throw new Error('DATABASE_PACKAGE_MIGRATION_COUNT_INVALID');
  if(selected!=='apex'&&!migrations.length)throw new Error('DATABASE_PACKAGE_MIGRATIONS_REQUIRED');

  const ids=new Set<string>();
  let totalBytes=0;
  const expectedMigrationComponent=selected==='engine-shared'?'shared':selected;

  for(const migration of migrations){
    const id=String(migration?.id||'').trim();
    const file=String(migration?.file||'').trim().replaceAll('\\','/');
    const migrationComponent=String(migration?.component||'').trim().toLowerCase();

    if(!id||ids.has(id))throw new Error('DATABASE_PACKAGE_MIGRATION_ID_INVALID');
    ids.add(id);

    if(!MIGRATION_PATHS[selected].test(file)||migrationComponent!==expectedMigrationComponent){
      throw new Error('DATABASE_PACKAGE_MIGRATION_SCOPE_INVALID:'+file);
    }

    if(migration?.encoding!=='base64'||typeof migration?.data!=='string'){
      throw new Error('DATABASE_PACKAGE_MIGRATION_ENCODING_INVALID:'+file);
    }

    const bytes=Buffer.from(migration.data,'base64');
    if(bytes.length<1||bytes.length>MAX_MIGRATION_BYTES||Number(migration.size)!==bytes.length){
      throw new Error('DATABASE_PACKAGE_MIGRATION_SIZE_INVALID:'+file);
    }

    const digest=sha256(bytes);
    if(digest!==String(migration.sha256||'').trim().toLowerCase()){
      throw new Error('DATABASE_PACKAGE_MIGRATION_CHECKSUM_INVALID:'+file);
    }

    const sql=bytes.toString('utf8');
    if(FORBIDDEN_INTERNAL_SQL.test(sql))throw new Error('DATABASE_PACKAGE_INTERNAL_SCHEMA_FORBIDDEN:'+file);
    if(DESTRUCTIVE_SQL.test(sql))throw new Error('DATABASE_PACKAGE_DESTRUCTIVE_SQL_FORBIDDEN:'+file);
    if(TRANSACTION_SQL.test(sql))throw new Error('DATABASE_PACKAGE_TRANSACTION_SQL_FORBIDDEN:'+file);

    totalBytes+=bytes.length;
  }

  const snapshot=input.snapshot??null;
  if(snapshot!==null){
    if(snapshot?.encoding!=='base64'||typeof snapshot?.data!=='string')throw new Error('DATABASE_PACKAGE_SNAPSHOT_ENCODING_INVALID');

    const bytes=Buffer.from(snapshot.data,'base64');
    if(bytes.length<1||Number(snapshot.size)!==bytes.length||sha256(bytes)!==String(snapshot.sha256||'').trim().toLowerCase()){
      throw new Error('DATABASE_PACKAGE_SNAPSHOT_CHECKSUM_INVALID');
    }

    const sql=bytes.toString('utf8');
    if(FORBIDDEN_INTERNAL_SQL.test(sql))throw new Error('DATABASE_PACKAGE_INTERNAL_SCHEMA_FORBIDDEN:snapshot');
    totalBytes+=bytes.length;
  }

  if(totalBytes>MAX_PACKAGE_BYTES)throw new Error('DATABASE_PACKAGE_TOO_LARGE');

  const normalized={
    ...input,
    format:FORMAT,
    packageVersion:1,
    component:selected,
    databaseTarget:'customer',
    sourceRepo,
    sourceCommit,
    databaseSchemaVersion,
    minimumBaseSchemaVersion,
    minimumBaseVersion,
    migrationCount,
    migrations
  };

  const bytes=canonicalBytes(normalized);
  if(bytes.length>MAX_PACKAGE_BYTES*2)throw new Error('DATABASE_PACKAGE_TOO_LARGE');

  return {
    package:normalized,
    component:selected,
    sourceRepo,
    sourceCommit,
    databaseSchemaVersion,
    minimumBaseSchemaVersion,
    minimumBaseVersion,
    packageSha256:sha256(bytes)
  };
}

export async function createDatabasePackageCandidate(input:any,actor:string){
  const validated=validateDatabasePackage(input);

  const existing=(await db().query(
    'select * from database_packages where component=$1 and database_schema_version=$2 and package_sha256=$3 and source_repo=$4 and source_commit=$5 limit 1',
    [validated.component,validated.databaseSchemaVersion,validated.packageSha256,validated.sourceRepo,validated.sourceCommit]
  )).rows[0];
  if(existing)return existing;

  const result=await db().query(
    `insert into database_packages(component,database_target,source_repo,source_commit,database_schema_version,minimum_base_schema_version,minimum_base_version,package_sha256,package,status,created_by)
     values($1,'customer',$2,$3,$4,$5,$6,$7,$8,'candidate',$9)
     returning *`,
    [
      validated.component,
      validated.sourceRepo,
      validated.sourceCommit,
      validated.databaseSchemaVersion,
      validated.minimumBaseSchemaVersion,
      validated.minimumBaseVersion,
      validated.packageSha256,
      JSON.stringify(validated.package),
      actor
    ]
  );
  return result.rows[0];
}

export async function publishDatabasePackage(id:string,actor:string){
  const client=await db().connect();
  try{
    await client.query('begin');
    const candidate=(await client.query('select * from database_packages where id=$1 for update',[id])).rows[0];

    if(!candidate)throw new Error('DATABASE_PACKAGE_NOT_FOUND');
    if(candidate.status==='current'){
      await client.query('commit');
      return candidate;
    }
    if(candidate.status!=='candidate')throw new Error('DATABASE_PACKAGE_NOT_PUBLISHABLE');

    const newer=(await client.query(
      "select 1 from database_packages where component=$1 and status='current' and database_schema_version>$2 limit 1",
      [candidate.component,candidate.database_schema_version]
    )).rows[0];
    if(newer)throw new Error('DATABASE_PACKAGE_VERSION_ROLLBACK');

    await client.query(
      "update database_packages set status='superseded',superseded_at=now() where component=$1 and status='current'",
      [candidate.component]
    );

    const published=(await client.query(
      "update database_packages set status='current',published_at=now(),published_by=$2 where id=$1 returning *",
      [id,actor]
    )).rows[0];

    await client.query('commit');
    return published;
  }catch(error){
    await client.query('rollback').catch(()=>undefined);
    throw error;
  }finally{
    client.release();
  }
}

export async function listDatabasePackages(componentFilter?:string){
  const values:any[]=[];
  let where='';
  if(componentFilter){
    values.push(component(componentFilter));
    where='where component=$1';
  }

  return (await db().query(
    `select id,component,database_target,source_repo,source_commit,database_schema_version,minimum_base_schema_version,minimum_base_version,package_sha256,status,created_by,published_by,created_at,published_at,superseded_at
     from database_packages ${where}
     order by component,database_schema_version desc,created_at desc`,
    values
  )).rows;
}

export async function getCurrentDatabasePackage(componentValue:string){
  const selected=component(componentValue);
  return (await db().query(
    "select * from database_packages where component=$1 and database_target='customer' and status='current' limit 1",
    [selected]
  )).rows[0]||null;
}

type ReleaseDatabasePackageReference={
  id:string;
  component:CustomerDatabaseComponent;
  databaseSchemaVersion:number;
  sha256:string;
  sourceCommit:string;
};

function releaseDatabaseComponents(row:any):CustomerDatabaseComponent[]{
  if(String(row?.release_type||'')==='base')return ['base'];
  const components=Array.isArray(row?.manifest?.components)?row.manifest.components:[];
  const selected=[...new Set(components.map((value:any)=>String(value||'').trim().toLowerCase()).filter((value:string)=>['mcp','apex','studio'].includes(value)))];
  return ['engine-shared',...selected] as CustomerDatabaseComponent[];
}

function releaseDatabaseReferences(row:any):ReleaseDatabasePackageReference[]{
  const contract=row?.manifest?.databasePackages;
  if(!contract||contract.format!=='orbitfs-database-package-set-v1'||!Array.isArray(contract.packages))return[];
  return contract.packages.map((item:any)=>({
    id:String(item?.id||'').trim(),
    component:String(item?.component||'').trim().toLowerCase() as CustomerDatabaseComponent,
    databaseSchemaVersion:Number(item?.databaseSchemaVersion),
    sha256:String(item?.sha256||'').trim().toLowerCase(),
    sourceCommit:String(item?.sourceCommit||'').trim().toLowerCase()
  }));
}

export async function validateReleaseDatabasePackages(row:any){
  const required=releaseDatabaseComponents(row);
  const refs=releaseDatabaseReferences(row);
  if(refs.length!==required.length){
    return {ok:false,message:`Release requires database packages [${required.join(', ')}], but ${refs.length} package reference(s) were supplied.`};
  }
  const refByComponent=new Map(refs.map((ref)=>[ref.component,ref]));
  const missing=required.filter((component)=>!refByComponent.has(component));
  const extra=refs.filter((ref)=>!required.includes(ref.component));
  if(missing.length||extra.length){
    return {ok:false,message:`Database package component set does not match release targets. Missing: ${missing.join(', ')||'none'}; extra: ${extra.map((x)=>x.component).join(', ')||'none'}.`};
  }
  const ids=refs.map((ref)=>ref.id);
  if(ids.some((id)=>!/^[0-9a-f-]{36}$/i.test(id))||new Set(ids).size!==ids.length){
    return {ok:false,message:'Database package references contain an invalid or duplicate id.'};
  }
  const rows=(await db().query(
    `select id,component,source_repo,source_commit,database_schema_version,package_sha256,status
     from database_packages where id = any($1::uuid[])`,
    [ids]
  )).rows;
  if(rows.length!==refs.length)return {ok:false,message:'One or more referenced database packages do not exist.'};
  const byId=new Map(rows.map((item:any)=>[String(item.id),item]));
  const releaseCommit=String(row?.source_sha||'').trim().toLowerCase();
  for(const ref of refs){
    const stored:any=byId.get(ref.id);
    if(!stored)return {ok:false,message:'Referenced database package was not found: '+ref.id};
    if(stored.component!==ref.component)return {ok:false,message:'Database package component mismatch for '+ref.id};
    if(!['candidate','current'].includes(String(stored.status||'')))return {ok:false,message:'Database package is not publishable/current: '+ref.id};
    if(String(stored.source_commit||'').toLowerCase()!==releaseCommit||ref.sourceCommit!==releaseCommit)return {ok:false,message:'Database package source commit does not match the release: '+ref.component};
    if(Number(stored.database_schema_version)!==ref.databaseSchemaVersion)return {ok:false,message:'Database package schema version reference mismatch: '+ref.component};
    if(String(stored.package_sha256||'').toLowerCase()!==ref.sha256||!/^[a-f0-9]{64}$/.test(ref.sha256))return {ok:false,message:'Database package checksum reference mismatch: '+ref.component};
    const releaseSourceRepo=String(row?.source_repo||'').trim();
    if(String(stored.source_repo||'')!==releaseSourceRepo)return {ok:false,message:'Database package source repository does not match the release source repository: '+ref.component};
  }
  return {ok:true,message:`Database package set is complete and source-locked: ${required.join(', ')}.`,packages:refs};
}

export async function publishReleaseDatabasePackages(client:any,row:any,actorUserId?:string|null,actor?:string){
  const validation=await validateReleaseDatabasePackages(row);
  if(!validation.ok)throw new Error(validation.message);
  const refs=validation.packages||[];
  const published:any[]=[];
  for(const ref of refs){
    const candidate=(await client.query('select * from database_packages where id=$1 for update',[ref.id])).rows[0];
    if(!candidate)throw new Error('DATABASE_PACKAGE_NOT_FOUND');
    if(!['candidate','current'].includes(String(candidate.status||'')))throw new Error('DATABASE_PACKAGE_NOT_PUBLISHABLE');
    const newer=(await client.query(
      "select 1 from database_packages where component=$1 and status='current' and database_schema_version>$2 and id<>$3 limit 1",
      [candidate.component,candidate.database_schema_version,candidate.id]
    )).rows[0];
    if(newer)throw new Error('DATABASE_PACKAGE_VERSION_ROLLBACK');

    await client.query(
      "update database_packages set status='superseded',superseded_at=coalesce(superseded_at,now()) where component=$1 and status='current' and id<>$2",
      [candidate.component,candidate.id]
    );
    const current=(await client.query(
      "update database_packages set status='current',published_at=coalesce(published_at,now()),published_by=coalesce(published_by,$2),superseded_at=null where id=$1 returning id,component,database_schema_version,package_sha256,source_commit,status",
      [candidate.id,actor??'release-publication']
    )).rows[0];
    published.push(current);
  }
  await client.query(
    "insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'database_package.release_publish','release',$3,$4)",
    [actorUserId??null,actor??'admin',row.id,JSON.stringify({packages:published})]
  );
  return published;
}
