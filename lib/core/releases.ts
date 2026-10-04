import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { db } from '../db';
import { requireReleaseChannel } from './release-channels';
import { compareOrbitReleaseVersions, isOrbitReleaseVersion, orbitReleaseVersionFamily } from './versioning';
import { publishReleaseDatabasePackages, validateReleaseDatabasePackages } from './database-packages';

const ALLOWED_UPDATE_COMPONENTS = new Set(['base', 'mcp', 'apex', 'studio']);
const MAX_ARTIFACT_BYTES = 75 * 1024 * 1024;
const FORBIDDEN_PATHS = /(^|\/)(\.env(?:$|\.(?!example$))|\.git(?:\/|$)|node_modules(?:\/|$)|\.vercel(?:\/|$))/i;
const BASE_DATABASE_RUNTIME_ACCESS_CONTRACT={
 version:1,
 schema:'public',
 publishableRole:'anon',
 authenticatedRole:'authenticated',
 serviceRole:'service_role',
 publicReadTables:['orbitfs_addons'],
 authenticatedReadTables:['orbitfs_addons'],
 serverFullAccessTables:['orbitfs_users','orbitfs_workspaces','orbitfs_workspace_members','orbitfs_files','orbitfs_settings','orbitfs_license','orbitfs_addons','orbitfs_audit_log','orbitfs_profile_state','orbitfs_schema_migrations'],
 restPreflightTables:['orbitfs_addons'],
 serverPreflightTables:['orbitfs_schema_migrations'],
 runtimeSecretHeader:'x-orbitfs-secret',
 runtimeSecretRoles:['anon','authenticated'],
 runtimeSecretTablePrefixes:['orbitfs_','mcp_','studio_','apex_'],
 runtimeSecretExcludedTables:['orbitfs_schema_migrations','orbitfs_runtime_secret_probe'],
 runtimeSecretPreflightTables:['orbitfs_addons','orbitfs_users','orbitfs_workspaces'],
 runtimeSecretRepairRpc:'orbitfs_repair_runtime_access',
 runtimeSecretProbeTable:'orbitfs_runtime_secret_probe'
};
const LEGACY_BASE_ENGINE_DEPLOYER_PROTOCOL=1;
const LOCAL_BASE_REPO='remipetrovich-design/OrbitFS-Base-System';
const LOCAL_BASE_REF='base-release';
const LOCAL_ENGINE_REPO='remipetrovich-design/OrbitFS_Engine';
const LOCAL_ENGINE_REF='main';
const LOCAL_SOURCE_REPOS=[LOCAL_BASE_REPO,LOCAL_ENGINE_REPO] as const;
const LOCAL_BASE_ARTIFACT_REPO='remipetrovich-design/OrbitFS-Base-System';
const LEGACY_BASE_ARTIFACT_REPO='remipetrovich-design/OrbitFS-Control-Centre';
const LOCAL_GITHUB_TOKEN_ENV='ORBITFS_FALLBACK_GITHUB_TOKEN';
function expectedReleaseSource(releaseType:unknown){
 return String(releaseType||'').toLowerCase()==='base'
  ? {repo:LOCAL_BASE_REPO,ref:LOCAL_BASE_REF}
  : {repo:LOCAL_ENGINE_REPO,ref:LOCAL_ENGINE_REF};
}
function isLocalReleaseRow(row:any){
 if(!row)return false;
 const expected=expectedReleaseSource(row.release_type);
 return String(row.source_repo||'').trim()===expected.repo;
}
function assertLocalReleaseRow(row:any){
 if(row&&!isLocalReleaseRow(row))throw new Error('RELEASE_SYSTEM_MISMATCH');
 return row;
}
function expectedReleaseArtifactRepo(releaseType:unknown){
 return String(releaseType||'').toLowerCase()==='base'
  ? LOCAL_BASE_ARTIFACT_REPO
  : LOCAL_ENGINE_REPO;
}
function releaseArtifactRepoAllowed(releaseType:unknown,value:unknown){
 const artifactRepo=String(value||'').trim();
 return String(releaseType||'').toLowerCase()==='base'
  ? artifactRepo===LOCAL_BASE_ARTIFACT_REPO||artifactRepo===LEGACY_BASE_ARTIFACT_REPO
  : artifactRepo===LOCAL_ENGINE_REPO;
}

function authoritativeDatabaseRuntimeAccess(){
 return {...BASE_DATABASE_RUNTIME_ACCESS_CONTRACT,publicReadTables:[...BASE_DATABASE_RUNTIME_ACCESS_CONTRACT.publicReadTables],authenticatedReadTables:[...BASE_DATABASE_RUNTIME_ACCESS_CONTRACT.authenticatedReadTables],serverFullAccessTables:[...BASE_DATABASE_RUNTIME_ACCESS_CONTRACT.serverFullAccessTables],restPreflightTables:[...BASE_DATABASE_RUNTIME_ACCESS_CONTRACT.restPreflightTables],serverPreflightTables:[...BASE_DATABASE_RUNTIME_ACCESS_CONTRACT.serverPreflightTables],runtimeSecretRoles:[...BASE_DATABASE_RUNTIME_ACCESS_CONTRACT.runtimeSecretRoles],runtimeSecretTablePrefixes:[...BASE_DATABASE_RUNTIME_ACCESS_CONTRACT.runtimeSecretTablePrefixes],runtimeSecretExcludedTables:[...BASE_DATABASE_RUNTIME_ACCESS_CONTRACT.runtimeSecretExcludedTables],runtimeSecretPreflightTables:[...BASE_DATABASE_RUNTIME_ACCESS_CONTRACT.runtimeSecretPreflightTables]};
}
export function withAuthoritativeReleaseRuntimeAccess(row:any){
 if(!row||String(row.release_type||'')!=='base')return row;
 const manifest=row.manifest&&typeof row.manifest==='object'?row.manifest:{};
 const declared=Number(manifest.engineDeployerProtocol||0);
 const engineDeployerProtocol=Number.isInteger(declared)&&declared>=1?declared:LEGACY_BASE_ENGINE_DEPLOYER_PROTOCOL;
 return {...row,manifest:{...manifest,databaseRuntimeAccess:authoritativeDatabaseRuntimeAccess(),engineDeployerProtocol}};
}

function canonicalComponents(value: unknown, releaseType: 'base' | 'update') { const values = Array.isArray(value) ? value.map((x) => String(x).trim().toLowerCase()).filter(Boolean) : []; if (releaseType === 'base') return ['base']; const mapped = values.map((x) => x === 'core' || x === 'orbitfs_base' ? 'base' : x === 'orbitfs_mcp' ? 'mcp' : x === 'orbitfs_apex' ? 'apex' : x === 'orbitfs_studio' ? 'studio' : x); return [...new Set(mapped)]; }
function databaseRuntimeAccessIdentity(){return createHash('sha256').update(JSON.stringify(authoritativeDatabaseRuntimeAccess())).digest('hex');}
function releaseValidationIdentity(row:any){return {source_sha:String(row.source_sha||''),checksum:String(row.checksum||''),artifact_run_id:Number(row.artifact_run_id||0),artifact_repo:String(row.artifact_repo||row.source_repo||''),artifact_tag:String(row.manifest?.artifactTag||''),artifact_name:String(row.artifact_name||''),database_runtime_access_contract_sha256:String(row.release_type||'')==='base'?databaseRuntimeAccessIdentity():''};}
function validationIdentityMatches(row:any){
 const expected=releaseValidationIdentity(row),actual=row.manifest?.validation?.identity;
 const base=String(row.release_type||'')==='base';
 const legacyPublishedBase=base&&!String(actual?.database_runtime_access_contract_sha256||'')&&['published','superseded','disabled'].includes(String(row.status||''));
 const runtimeAccessIdentityMatches=!base||legacyPublishedBase||String(actual?.database_runtime_access_contract_sha256||'')===expected.database_runtime_access_contract_sha256;
 return Boolean(actual&&expected.source_sha&&expected.checksum&&expected.artifact_run_id&&expected.artifact_repo&&expected.artifact_tag&&expected.artifact_name&&actual.source_sha===expected.source_sha&&actual.checksum===expected.checksum&&Number(actual.artifact_run_id)===expected.artifact_run_id&&String(actual.artifact_repo||'')===expected.artifact_repo&&String(actual.artifact_tag||'')===expected.artifact_tag&&String(actual.artifact_name||'')===expected.artifact_name&&runtimeAccessIdentityMatches);
}
function validationManifest(row: any, checks: any[], status: 'passed' | 'failed') { return { ...(row.manifest || {}), validation: { status, checked_at: new Date().toISOString(), identity:releaseValidationIdentity(row), checks } }; }
function inspectPackageFiles(files:any[],options:{label:string;componentMode?:'engine-v3'|'none'}){
  const list=Array.isArray(files)?files:[];
  const seen=new Set<string>();
  const duplicates:string[]=[];
  const forbidden:string[]=[];
  const invalidComponents:string[]=[];
  let invalidPayload=0;
  let invalidStructure=0;
  for(const f of list){
    const file=String(f?.file||'');
    if(!f||!file||!/^[a-f0-9]{64}$/i.test(String(f.sha256||''))||!Number.isInteger(f.size)||f.size<0||typeof f.data!=='string')invalidStructure++;
    if(seen.has(file))duplicates.push(file);else seen.add(file);
    if(FORBIDDEN_PATHS.test(file))forbidden.push(file);
    if(options.componentMode==='engine-v3'&&!['shared','apex','mcp','studio','core'].includes(String(f?.component||'')))invalidComponents.push(file);
    try{
      const data=Buffer.from(String(f?.data||''),'base64');
      const hash=createHash('sha256').update(data).digest('hex');
      if(data.length!==Number(f?.size)||hash.toLowerCase()!==String(f?.sha256||'').toLowerCase())invalidPayload++;
    }catch{invalidPayload++;}
  }
  return {label:options.label,list,invalidStructure,duplicates:[...new Set(duplicates)],forbidden,invalidComponents,invalidPayload};
}
function appendFileChecks(checks:any[],result:ReturnType<typeof inspectPackageFiles>,prefix='package'){
  const name=result.label;
  checks.push({key:`${prefix}_files`,ok:result.list.length>0&&result.invalidStructure===0,message:result.list.length>0&&result.invalidStructure===0?`${name} contains ${result.list.length} structurally valid file(s).`:`${name} file list is empty or malformed.`});
  checks.push({key:`${prefix}_paths`,ok:result.forbidden.length===0,message:result.forbidden.length?`${name} contains forbidden paths: ${result.forbidden.slice(0,5).join(', ')}`:`${name} paths passed security scan.`});
  checks.push({key:`${prefix}_duplicates`,ok:result.duplicates.length===0,message:result.duplicates.length?`${name} contains duplicate paths: ${result.duplicates.slice(0,5).join(', ')}`:`${name} contains no duplicate paths.`});
  if(result.invalidComponents.length)checks.push({key:`${prefix}_components`,ok:false,message:`${name} has files without valid Engine component metadata: ${result.invalidComponents.slice(0,5).join(', ')}`});
  checks.push({key:`${prefix}_file_integrity`,ok:result.invalidPayload===0,message:result.invalidPayload===0?`Every ${name} file matches its declared size and SHA-256.`:`${result.invalidPayload} ${name} file(s) failed size/SHA-256 verification.`});
}
function invalidSqlSequenceTargets(sql:string){
  const constraintNames=new Set([...String(sql||'').matchAll(/\b(?:add\s+constraint|constraint)\s+"?([a-z0-9_]+)"?\s+(?:primary\s+key|unique)\b/ig)].map((match)=>String(match[1]||'').toLowerCase()));
  return [...new Set([...String(sql||'').matchAll(/\b(?:pg_catalog\.)?setval\s*\(\s*'([^']+)'\s*(?:::regclass)?/ig)].map((match)=>String(match[1]||'').replaceAll('"','')).filter((target)=>{
    const relation=target.split('.').at(-1)?.toLowerCase()||'';
    return relation.endsWith('_pkey')||constraintNames.has(relation);
  }))];
}
function baseMigrationChainFromFiles(files:any[]){
  const rows:Array<{id:string;file:string;size:number;sha256:string}>=[];
  const invalidSequenceTargets:Array<{file:string;target:string}>=[];
  const seen=new Set<string>();
  let valid=true;
  for(const entry of Array.isArray(files)?files:[]){
    const file=String(entry?.file||'').replaceAll('\\','/');
    const match=file.match(/^supabase\/migrations\/([0-9]{14})_[A-Za-z0-9._-]+\.sql$/);
    if(!match)continue;
    const id=match[1];
    if(seen.has(id)){valid=false;continue;}
    seen.add(id);
    if(entry?.encoding!=='base64'||typeof entry?.data!=='string'){valid=false;continue;}
    const bytes=Buffer.from(entry.data,'base64');
    const sha256=createHash('sha256').update(bytes).digest('hex');
    if(bytes.length!==Number(entry?.size)||sha256!==String(entry?.sha256||'').toLowerCase()){valid=false;continue;}
    const invalidTargets=invalidSqlSequenceTargets(bytes.toString('utf8'));
    if(invalidTargets.length){valid=false;invalidSequenceTargets.push(...invalidTargets.map((target)=>({file,target})));}
    rows.push({id,file,size:bytes.length,sha256});
  }
  rows.sort((a,b)=>a.id.localeCompare(b.id));
  for(let index=1;index<rows.length;index++)if(rows[index].id<=rows[index-1].id)valid=false;
  return {rows,valid,invalidSequenceTargets};
}
async function scanPackage(row:any,bytes:Buffer){
  const checks:any[]=[];
  if(!String(row.artifact_name||'').endsWith('.json.gz')){
    checks.push({key:'package_format',ok:false,message:'Release artifact must be the OrbitFS .json.gz package format.'});
    return checks;
  }
  try{
    const raw=gunzipSync(bytes).toString('utf8');
    const pkg=JSON.parse(raw);
    const validReleaseVersion=(value:any)=>isOrbitReleaseVersion(String(value||'').trim());
    const isBundle=pkg.format==='orbitfs-update-bundle-v3'&&Number(pkg.schemaVersion)===3;

    if(isBundle){
      const components=canonicalComponents(pkg.components,'update');
      const recordComponents=canonicalComponents(row.manifest?.components,'update');
      const validTargets=components.length>0&&components.every((x:string)=>ALLOWED_UPDATE_COMPONENTS.has(x));
      const componentRecordMatches=[...components].sort().join(',')===[...recordComponents].sort().join(',');
      const baseTarget=components.includes('base');
      const engineTargets=components.filter((component:string)=>component!=='base');
      const panel=pkg?.payloads?.panel??null;
      const engine=pkg?.payloads?.engine??null;
      const protocol=Number(pkg.minimumEngineDeployerProtocol);
      const compatibility=validReleaseVersion(pkg.minimumBaseVersion)&&(!engineTargets.length||(Number.isInteger(protocol)&&protocol>=1&&pkg.checkpointRequired===true));
      const componentVersions=pkg.componentVersions&&typeof pkg.componentVersions==='object'&&!Array.isArray(pkg.componentVersions)?pkg.componentVersions:null;
      const componentVersionsValid=Boolean(componentVersions&&components.every((component:string)=>{
        if(component==='base')return true;
        const value=String(componentVersions[component]||'').trim();
        return validReleaseVersion(value);
      })&&Object.keys(componentVersions).every((key)=>components.includes(String(key))));
      const database=pkg?.database&&typeof pkg.database==='object'&&!Array.isArray(pkg.database)?pkg.database:null;
      const migrations=Array.isArray(database?.migrations)?database.migrations:[];
      const migrationIds=new Set<string>();
      const invalidMigrationSequenceTargets:string[]=[];
      const changedMigrationCount=Number(pkg.databaseChangedMigrationCount??0);
      let migrationsValid=Boolean(database&&database.format==='orbitfs-db-migrations-v1'&&database.mode==='shared-panel'&&database.provider==='supabase'&&Number(database.migrationCount||0)===migrations.length&&Number(pkg.databaseMigrationCount||0)===migrations.length&&Number.isInteger(changedMigrationCount)&&changedMigrationCount>=0&&changedMigrationCount<=migrations.length);
      for(const migration of migrations){
        const id=String(migration?.id||''),file=String(migration?.file||'').replaceAll('\\','/');
        const match=file.match(/^supabase\/migrations\/(shared|base|apex|mcp|studio)\/(\d{14}_[A-Za-z0-9._-]+)\.sql$/);
        const component=String(migration?.component||'').toLowerCase();
        if(!match||id!==match[1]+'.'+match[2]||migrationIds.has(id)||component!==match[1]||migration?.encoding!=='base64'||typeof migration?.data!=='string'){migrationsValid=false;continue;}
        if(component!=='shared'&&!components.includes(component))migrationsValid=false;
        migrationIds.add(id);
        const sql=Buffer.from(migration.data,'base64');
        const sha=createHash('sha256').update(sql).digest('hex');
        const sqlText=sql.toString('utf8');
        const invalidSequenceTargets=invalidSqlSequenceTargets(sqlText);
        if(invalidSequenceTargets.length)invalidMigrationSequenceTargets.push(...invalidSequenceTargets.map((target)=>`${file}: ${target}`));
        if(sql.length!==Number(migration.size)||sha!==String(migration.sha256||'').toLowerCase()||/\b(?:begin|commit|rollback)\s*;/i.test(sqlText)||/\b(?:drop\s+table|drop\s+schema|truncate\s+(?:table\s+)?|alter\s+table[\s\S]{0,300}?drop\s+column)\b/i.test(sqlText)||invalidSequenceTargets.length>0)migrationsValid=false;
      }
      const schemaChanged=pkg?.releaseAnalysis?.flags?.schemaChanged===true;
      if(schemaChanged&&changedMigrationCount<1)migrationsValid=false;
      const engineDatabaseOk=!engine||JSON.stringify(engine.database||null)===JSON.stringify(database);
      const databaseOk=migrationsValid&&engineDatabaseOk;
      const legacyUpdateContract=!baseTarget&&pkg.updateScope==='engine-components-only-v1'&&pkg.executor==='orbitfs-base-inner-deployer-v1';
      const updateScopeOk=((pkg.updateScope==='deployed-system-v2'&&pkg.executor==='orbitfs-updater-v2')||legacyUpdateContract)&&!pkg.baseBaseline;
      checks.push({key:'package_manifest',ok:Boolean(pkg.version&&pkg.sourceCommit&&validTargets&&componentRecordMatches&&componentVersionsValid&&pkg.payloads&&typeof pkg.payloads==='object'&&updateScopeOk),message:'Update bundle identity, deployed-system targets, component versions and updater execution contract are '+(pkg.version&&pkg.sourceCommit&&validTargets&&componentRecordMatches&&componentVersionsValid&&updateScopeOk?'valid.':'invalid.')});
      checks.push({key:'package_update_scope',ok:updateScopeOk,message:updateScopeOk?(pkg.executor==='orbitfs-updater-v2'?'Update is owned by the standalone OrbitFS Updater.':'Legacy published Update contract is accepted for compatibility.'):'Update scope/executor does not match the standalone Updater contract.'});
      checks.push({key:'package_components_match',ok:componentRecordMatches,message:componentRecordMatches?'Release record components exactly match the packaged Update targets.':'Release record components do not match the packaged Update targets.'});
      checks.push({key:'package_update_schema',ok:databaseOk,message:databaseOk?(migrations.length?`Customer database migration contract contains ${migrations.length} verified immutable migration(s).`:'Update release has a valid empty customer database migration contract.'):'Update database/schema changes require a valid checksummed orbitfs-db-migrations-v1 contract that matches the Engine payload.'});
      checks.push({key:'package_update_sequence_targets',ok:invalidMigrationSequenceTargets.length===0,message:invalidMigrationSequenceTargets.length?`Update migration SQL contains invalid setval() sequence target(s): ${invalidMigrationSequenceTargets.slice(0,5).join(', ')}.`:'Update migration setval() targets do not reference primary/unique constraints.'});
      checks.push({key:'package_engine_compatibility',ok:compatibility,message:compatibility?(engineTargets.length?'Minimum Base version, deployer protocol and checkpoint contract are valid.':'Minimum Base compatibility is valid for this Base-only Update.'):'Update bundle compatibility metadata is invalid.'});

      const panelOk=baseTarget
        ?Boolean(panel&&typeof panel==='object'&&Array.isArray(panel.files)&&panel.files.length>0)
        :panel===null||panel===undefined;
      checks.push({key:'package_panel_payload',ok:panelOk,message:baseTarget?(panelOk?'Base/inner-deployer payload is present for the deployed-system Update.':'Base-targeting Update requires a Base/Panel payload.'):(panelOk?'No Base payload is present for this Engine/addon Update.':'Update declares no Base target but contains a Base/Panel payload.')});

      const rawEngineComponents=engine?canonicalComponents(engine.components,'update'):[];
      const engineHasBase=rawEngineComponents.includes('base');
      const engineComponents=rawEngineComponents.filter((x:string)=>['mcp','apex','studio'].includes(x));
      const expectedEngine=[...engineTargets].sort().join(',');
      const actualEngine=[...engineComponents].sort().join(',');
      const engineFormat=engine&&['orbitfs-engine-release-v2','orbitfs-engine-release-v3'].includes(String(engine.format||''));
      const engineOk=!engineTargets.length?(engine===null||engine===undefined):Boolean(engine&&!engineHasBase&&engineFormat&&String(engine.version||'')===String(pkg.version||'')&&String(engine.sourceCommit||'')===String(pkg.sourceCommit||'')&&String(engine.minimumBaseVersion||'')===String(pkg.minimumBaseVersion||'')&&Number(engine.minimumEngineDeployerProtocol)===protocol&&engine.checkpointRequired===true&&actualEngine===expectedEngine);
      checks.push({key:'package_engine_payload',ok:engineOk,message:engineTargets.length?(engineOk?'Engine/add-on targets have a valid Engine Host payload.':'Engine/add-on targets require a matching Engine Host payload.'):(engine===null?'No Engine payload is present for a Base-only update.':'Engine payload must be null when no Engine/add-on target is selected.')});

      let total=0;
      if(panel){
        const inspected=inspectPackageFiles(panel.files,{label:'Panel payload'});
        appendFileChecks(checks,inspected,'package_panel');
        total+=inspected.list.length;
        checks.push({key:'package_panel_file_count',ok:Number(panel.fileCount||0)===inspected.list.length,message:`Panel payload declares ${Number(panel.fileCount||0)} file(s); scanned ${inspected.list.length}.`});
      }
      if(engine){
        const inspected=inspectPackageFiles(engine.files,{label:'Engine payload',componentMode:Number(engine.schemaVersion||0)>=3?'engine-v3':'none'});
        appendFileChecks(checks,inspected,'package_engine');
        total+=inspected.list.length;
        checks.push({key:'package_engine_file_count',ok:Number(engine.fileCount||0)===inspected.list.length,message:`Engine payload declares ${Number(engine.fileCount||0)} file(s); scanned ${inspected.list.length}.`});
      }
      checks.push({key:'package_files',ok:total>0&&Number(pkg.fileCount||0)===total,message:`Update bundle contains ${total} nested file(s).`});
      checks.push({key:'package_version',ok:String(pkg.version||'')===String(row.version||''),message:String(pkg.version||'')===String(row.version||'')?'Package version matches release version.':'Package version does not match release version.'});
      checks.push({key:'package_source',ok:String(pkg.sourceCommit||'')===String(row.source_sha||''),message:String(pkg.sourceCommit||'')===String(row.source_sha||'')?'Package source commit matches release source.':'Package source commit does not match release source.'});
      return checks;
    }

    const files=Array.isArray(pkg.files)?pkg.files:[];
    if(row.release_type==='base'){
      const packageDatabaseSchema=String(pkg.databaseSchemaVersion||pkg.releaseInfo?.databaseSchemaVersion||'').trim();
      const releaseDatabaseSchema=String(row.manifest?.databaseSchemaVersion||row.manifest?.releaseInfo?.databaseSchemaVersion||'').trim();
      const schemaPath=String(pkg.databaseSchemaPath||pkg.releaseInfo?.databaseSchemaPath||'supabase/customer-schema.sql').trim();
      const packageSchemaHash=String(pkg.databaseSchemaSha256||pkg.releaseInfo?.databaseSchemaSha256||'').trim().toLowerCase();
      const releaseSchemaHash=String(row.manifest?.databaseSchemaSha256||row.manifest?.releaseInfo?.databaseSchemaSha256||'').trim().toLowerCase();
      const schemaFile=files.find((file:any)=>String(file?.file||'')===schemaPath);
      let actualSchemaHash='',schemaPayloadOk=false,schemaReplaySafe=false,schemaReplayMessage='Customer DB snapshot could not be inspected.',schemaRuntimeAccessOk=false;
      let schemaInvalidSequenceTargets:string[]=[];
      if(schemaFile?.data&&schemaFile?.encoding==='base64'){
        const bytes=Buffer.from(schemaFile.data,'base64');
        actualSchemaHash=createHash('sha256').update(bytes).digest('hex');
        const sql=bytes.toString('utf8');
        schemaPayloadOk=bytes.length>0&&['orbitfs_users','orbitfs_workspaces','orbitfs_workspace_members','orbitfs_files','orbitfs_settings','orbitfs_license','orbitfs_addons','orbitfs_audit_log'].every((name)=>sql.includes(name));
        schemaRuntimeAccessOk=[
          'orbitfs_repair_runtime_access',
          'orbitfs_runtime_secret_probe',
          'private.orbitfs_server_secret_valid',
          'orbitfs runtime secret access',
          'orbitfs runtime secret required'
        ].every((marker)=>sql.includes(marker));
        const obsoleteProfileConflict=/on\s+conflict\s*\(\s*workspace_id\s*,\s*user_id\s*\)\s+do\s+nothing/i.test(sql);
        const unsafeUniqueAdds=[...sql.matchAll(/alter\s+table\s+([a-z0-9_.]+)\s+add\s+constraint\s+([a-z0-9_]+)\s+unique\s*\(/ig)].filter((match)=>{
          const before=sql.slice(Math.max(0,(match.index||0)-300),match.index||0).toLowerCase();
          return !before.includes(`drop constraint if exists ${String(match[2]).toLowerCase()}`);
        });
        const invalidSequenceTargets=invalidSqlSequenceTargets(sql);
        schemaInvalidSequenceTargets=invalidSequenceTargets;
        schemaReplaySafe=!obsoleteProfileConflict&&unsafeUniqueAdds.length===0&&invalidSequenceTargets.length===0;
        schemaReplayMessage=invalidSequenceTargets.length
          ?`Customer DB snapshot contains invalid setval() sequence target(s): ${invalidSequenceTargets.join(', ')}.`
          :obsoleteProfileConflict
            ?'Customer DB snapshot contains the obsolete profile-state ON CONFLICT(workspace_id,user_id) target.'
            :unsafeUniqueAdds.length
              ?`Customer DB snapshot contains non-replay-safe UNIQUE constraint creation: ${unsafeUniqueAdds[0][2]}.`
              :'Customer DB snapshot is replay-safe for profile-state conflict handling, named UNIQUE constraints and sequence resets.';
      }
      const migrationCount=Number(pkg.databaseMigrationCount??pkg.releaseInfo?.databaseMigrationCount??0);
      const latestMigration=String(pkg.databaseLatestMigration||pkg.releaseInfo?.databaseLatestMigration||'').trim();
      const releaseMigrationCount=Number(row.manifest?.databaseMigrationCount??row.manifest?.releaseInfo?.databaseMigrationCount??0);
      const releaseLatestMigration=String(row.manifest?.databaseLatestMigration||row.manifest?.releaseInfo?.databaseLatestMigration||'').trim();
      const migrationChain=baseMigrationChainFromFiles(files);
      const migrationChainOk=Boolean(
        migrationChain.valid
        &&migrationChain.rows.length===migrationCount
        &&migrationChain.rows.at(-1)?.id===latestMigration
      );
      const databaseSnapshotOk=Boolean(
        schemaPayloadOk
        &&packageSchemaHash
        &&releaseSchemaHash
        &&actualSchemaHash===packageSchemaHash
        &&packageSchemaHash===releaseSchemaHash
        &&Number.isInteger(migrationCount)
        &&migrationCount>0
        &&migrationCount===releaseMigrationCount
        &&/^\d{14}$/.test(latestMigration)
        &&latestMigration===releaseLatestMigration
        &&migrationChainOk
      );
      const recordManifest=row.manifest&&typeof row.manifest==='object'?row.manifest:{};
      const packageComponents=canonicalComponents(pkg.components,'base');
      const recordComponents=canonicalComponents(recordManifest.components,'base');
      const packageSettings=pkg.projectSettings&&typeof pkg.projectSettings==='object'&&!Array.isArray(pkg.projectSettings)?pkg.projectSettings:{};
      const recordSettings=recordManifest.projectSettings&&typeof recordManifest.projectSettings==='object'&&!Array.isArray(recordManifest.projectSettings)?recordManifest.projectSettings:{};
      const projectSettingsMatch=
        String(recordSettings.framework||'')===String(packageSettings.framework||'')
        &&String(recordSettings.installCommand||'')===String(packageSettings.installCommand||'')
        &&String(recordSettings.buildCommand||'')===String(packageSettings.buildCommand||'');
      const packageRuntimeOwnership=pkg.runtimeOwnership&&typeof pkg.runtimeOwnership==='object'&&!Array.isArray(pkg.runtimeOwnership)?pkg.runtimeOwnership:{};
      const recordRuntimeOwnership=recordManifest.runtimeOwnership&&typeof recordManifest.runtimeOwnership==='object'&&!Array.isArray(recordManifest.runtimeOwnership)?recordManifest.runtimeOwnership:{};
      const expectedExcludedTargets=['apex','mcp','studio'];
      const runtimeOwnershipOk=
        String(packageRuntimeOwnership.base||'')==='base-deployer-updater'
        &&String(packageRuntimeOwnership.innerDeployer||'')==='base'
        &&String(packageRuntimeOwnership.engineUpdaterExecutor||'')==='base-inner-deployer-v1'
        &&Array.isArray(packageRuntimeOwnership.excludedUpdateTargets)
        &&[...packageRuntimeOwnership.excludedUpdateTargets].map(String).sort().join(',')===expectedExcludedTargets.slice().sort().join(',');
      const runtimeOwnershipHandoffMatches=
        String(recordRuntimeOwnership.base||'')===String(packageRuntimeOwnership.base||'')
        &&String(recordRuntimeOwnership.innerDeployer||'')===String(packageRuntimeOwnership.innerDeployer||'')
        &&String(recordRuntimeOwnership.engineUpdaterExecutor||'')===String(packageRuntimeOwnership.engineUpdaterExecutor||'')
        &&Array.isArray(recordRuntimeOwnership.excludedUpdateTargets)
        &&Array.isArray(packageRuntimeOwnership.excludedUpdateTargets)
        &&[...recordRuntimeOwnership.excludedUpdateTargets].map(String).sort().join(',')===[...packageRuntimeOwnership.excludedUpdateTargets].map(String).sort().join(',');
      const handoffMatches=String(recordManifest.format||'')===String(pkg.format||'')
        &&Number(recordManifest.schemaVersion||0)===Number(pkg.schemaVersion||0)
        &&Number(recordManifest.fileCount||0)===Number(pkg.fileCount||0)
        &&Number(pkg.fileCount||0)===files.length
        &&packageComponents.join(',')===recordComponents.join(',')
        &&projectSettingsMatch
        &&runtimeOwnershipHandoffMatches;
      checks.push({key:'package_base_handoff',ok:handoffMatches,message:handoffMatches?'License Manager handoff metadata matches the embedded Base package manifest.':'License Manager handoff metadata must match the embedded Base package format, schema version, file count, components, runtime ownership and project settings.'});
      checks.push({key:'package_base_runtime_ownership',ok:runtimeOwnershipOk,message:runtimeOwnershipOk?'Base owns the Base Deployer/Updater and inner deployer; normal Updates are reserved for MCP/APEX/Studio through that inner deployer.':'Base release must declare Base/inner-deployer ownership and exclude MCP/APEX/Studio from the Base release path.'});
      checks.push({key:'package_base_format',ok:pkg.format==='orbitfs-base-deployment-v2'&&Number(pkg.schemaVersion)===2,message:pkg.format==='orbitfs-base-deployment-v2'&&Number(pkg.schemaVersion)===2?'Base artifact uses orbitfs-base-deployment-v2.':'Base artifact must use orbitfs-base-deployment-v2 package schema 2.'});
      checks.push({key:'database_schema_version',ok:Boolean(packageDatabaseSchema&&releaseDatabaseSchema&&packageDatabaseSchema===releaseDatabaseSchema),message:packageDatabaseSchema&&releaseDatabaseSchema&&packageDatabaseSchema===releaseDatabaseSchema?`Base database schema version ${packageDatabaseSchema} is consistent.`:'Base artifact and release record must declare the same databaseSchemaVersion.'});
      checks.push({key:'database_migration_chain',ok:migrationChainOk,message:migrationChainOk?`Base artifact contains ${migrationChain.rows.length} verified migration file(s) through ${latestMigration}.`:'Base artifact migration files must exactly match databaseMigrationCount/databaseLatestMigration and pass size/SHA-256 verification.'});
      checks.push({key:'database_migration_sequence_targets',ok:migrationChain.invalidSequenceTargets.length===0,message:migrationChain.invalidSequenceTargets.length?`Base migration SQL contains invalid setval() sequence target(s): ${migrationChain.invalidSequenceTargets.slice(0,5).map((item)=>`${item.file}: ${item.target}`).join(', ')}.`:'Base migration setval() targets do not reference primary/unique constraints.'});
      checks.push({key:'database_schema_snapshot',ok:databaseSnapshotOk,message:databaseSnapshotOk?`Base artifact contains the verified customer DB snapshot (${migrationCount} migrations, latest ${latestMigration}).`:'Base artifact must contain a checksummed supabase/customer-schema.sql generated from the authoritative migration chain.'});
      checks.push({key:'database_schema_replay_safety',ok:schemaReplaySafe,message:schemaReplayMessage});
      checks.push({key:'database_schema_sequence_targets',ok:schemaInvalidSequenceTargets.length===0,message:schemaInvalidSequenceTargets.length?`Customer DB snapshot contains invalid setval() sequence target(s): ${schemaInvalidSequenceTargets.join(', ')}. Rebuild the Base package from a corrected database snapshot.`:'Customer DB snapshot setval() targets do not reference primary/unique constraints.'});
      checks.push({key:'database_runtime_secret_contract',ok:schemaRuntimeAccessOk,message:schemaRuntimeAccessOk?'Customer DB snapshot contains the restricted Engine runtime-secret repair and probe contract.':'Customer DB snapshot is missing the restricted Engine runtime-secret repair/probe contract required by the Inner Engine deployer.'});
      const baseFilePaths=new Set(files.map((file:any)=>String(file?.file||'')));
      const requiredRuntimeFiles=[
        'deployment/base-environment.json',
        'tools/prepare-license-runtime.mjs',
        'src/lib/server/vercel-engine-provision.ts',
        'src/lib/server/engine-host.ts',
        'src/lib/server/engine-release-client.ts',
        'src/lib/server/engine-update-planner.ts',
        'src/lib/server/license.ts',
        'src/lib/server/runtime-secrets.ts',
        'src/routes/api/engine-host/+server.ts',
        'src/routes/api/engine-host/[action]/+server.ts',
        'src/routes/api/engine-host/launch/+server.ts',
        'src/routes/api/engine-license/+server.ts',
        'src/routes/api/license/activate/+server.ts',
        'src/routes/api/license/status/+server.ts',
        'src/hooks.server.ts',
        'src/routes/setup/+page.svelte',
        'src/routes/setup/owner/+page.svelte',
        'src/routes/api/setup/[...rest]/+server.ts',
        'src/routes/api/setup/status/+server.ts',
        'src/routes/api/setup/owner/+server.ts',
        'src/routes/api/store/update-engine/+server.ts'
      ];
      const missingRuntimeFiles=requiredRuntimeFiles.filter((path)=>!baseFilePaths.has(path));
      checks.push({key:'package_base_runtime_files',ok:missingRuntimeFiles.length===0,message:missingRuntimeFiles.length?'Base artifact is missing required runtime/deployer files: '+missingRuntimeFiles.join(', '):'Base artifact contains the required runtime/deployer files.'});
      const innerDeployerFile=files.find((file:any)=>String(file?.file||'')==='src/lib/server/vercel-engine-provision.ts');
      let innerDeployerRuntimeAccessOk=false;
      if(innerDeployerFile?.encoding==='base64'&&typeof innerDeployerFile?.data==='string'){
        const source=Buffer.from(innerDeployerFile.data,'base64').toString('utf8');
        innerDeployerRuntimeAccessOk=[
          'ORBITFS_DATABASE_RUNTIME_ACCESS_CONTRACT',
          'ENGINE_DATABASE_RUNTIME_ACCESS_REPAIR_UNAVAILABLE',
          'runtimeSecretProbeTable',
          'repairEngineDatabaseRuntimeAccess',
          'ORBITFS_SUPABASE_CONNECTION_ATTESTATION',
          'ENGINE_SUPABASE_PROJECT_MISMATCH',
          'ENGINE_SUPABASE_PUBLISHABLE_KEY_MISMATCH',
          'ENGINE_SUPABASE_SERVER_KEY_MISMATCH',
          'ENGINE_DATABASE_PUBLISHABLE_KEY_REJECTED',
          'ENGINE_DATABASE_SERVER_KEY_REJECTED'
        ].every((marker)=>source.includes(marker))&&!source.includes('legacy-service-key-fallback');
      }
      checks.push({key:'package_base_inner_deployer_database_contract',ok:innerDeployerRuntimeAccessOk,message:innerDeployerRuntimeAccessOk?'Inner Engine deployer carries the restricted runtime-access repair, secret probe and no-service-key-fallback contract.':'Inner Engine deployer must repair/probe restricted runtime DB access and must not contain the legacy service-key fallback.'});
      const environmentFile=files.find((file:any)=>String(file?.file||'')==='deployment/base-environment.json');
      let supabaseConnectionAttestationOk=false;
      if(environmentFile?.encoding==='base64'&&typeof environmentFile?.data==='string'){
        try{
          const environment=JSON.parse(Buffer.from(environmentFile.data,'base64').toString('utf8'));
          const names=new Set((Array.isArray(environment?.variables)?environment.variables:[]).map((item:any)=>String(item?.name||'')));
          supabaseConnectionAttestationOk=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','ORBITFS_SUPABASE_CONNECTION_ATTESTATION','ORBITFS_DB_SECRET'].every((name)=>names.has(name));
        }catch{}
      }
      checks.push({key:'package_base_supabase_connection_attestation',ok:supabaseConnectionAttestationOk,message:supabaseConnectionAttestationOk?'Base deployment environment declares the Billing-to-Base Supabase connection attestation.':'Base deployment environment must declare the Supabase connection attestation and required Supabase credentials.'});
      const declaredBaseEngineProtocol=pkg.engineDeployerProtocol??pkg.releaseInfo?.engineDeployerProtocol;
      const baseEngineProtocol=declaredBaseEngineProtocol===undefined?LEGACY_BASE_ENGINE_DEPLOYER_PROTOCOL:Number(declaredBaseEngineProtocol);
      const baseEngineProtocolOk=Number.isInteger(baseEngineProtocol)&&baseEngineProtocol>=1;
      checks.push({key:'package_base_engine_deployer_protocol',ok:baseEngineProtocolOk,message:baseEngineProtocolOk?`Base declares Inner Engine deployer protocol ${baseEngineProtocol}.`:'Base artifact declares an invalid Inner Engine deployer protocol.'});
    }
    const isEngineV3=pkg.format==='orbitfs-engine-release-v3';
    const inspected=inspectPackageFiles(files,{label:'Release package',componentMode:isEngineV3?'engine-v3':'none'});
    const validState=!isEngineV3||(pkg.componentVersions&&typeof pkg.componentVersions==='object'&&pkg.minimumBaseVersion&&Array.isArray(pkg.components));
    const engineCompatibility=row.release_type!=='update'||(Array.isArray(pkg.components)&&pkg.components.length>0&&Number.isInteger(Number(pkg.minimumEngineDeployerProtocol))&&Number(pkg.minimumEngineDeployerProtocol)>=1&&validReleaseVersion(pkg.minimumBaseVersion));
    checks.push({key:'package_manifest',ok:Boolean(pkg.schemaVersion&&pkg.version&&pkg.sourceCommit&&inspected.invalidStructure===0&&validState),message:(inspected.invalidStructure===0&&validState)?'Package manifest structure and target release state are valid.':'Package manifest structure or target release state is invalid.'});
    if(row.release_type==='update')checks.push({key:'package_engine_compatibility',ok:engineCompatibility,message:engineCompatibility?'Engine minimum Base version, deployer protocol and component metadata are valid.':'Engine artifact is missing or has invalid minimum Base version, deployer protocol or component metadata.'});
    appendFileChecks(checks,inspected,'package');
    checks.push({key:'package_version',ok:String(pkg.version||'')===String(row.version||''),message:String(pkg.version||'')===String(row.version||'')?'Package version matches release version.':'Package version does not match release version.'});
    checks.push({key:'package_source',ok:String(pkg.sourceCommit||'')===String(row.source_sha||''),message:String(pkg.sourceCommit||'')===String(row.source_sha||'')?'Package source commit matches release source.':'Package source commit does not match release source.'});
    checks.push({key:'package_file_count',ok:files.length>0&&Number(pkg.fileCount||files.length)===files.length,message:`Package contains ${files.length} files.`});
  }catch(error){
    checks.push({key:'package_scan',ok:false,message:error instanceof Error?`Package scan failed: ${error.message}`:'Package scan failed.'});
  }
  return checks;
}
function baseDatabaseManifestPatch(row:any,bytes:Buffer){
  if(row.release_type!=='base')return null;
  try{
    const pkg=JSON.parse(gunzipSync(bytes).toString('utf8'));
    if(pkg?.format!=='orbitfs-base-deployment-v2'||Number(pkg?.schemaVersion)!==2)return null;
    const files=Array.isArray(pkg.files)?pkg.files:[];
    const databaseSchemaVersion=String(pkg.databaseSchemaVersion||pkg.releaseInfo?.databaseSchemaVersion||'').trim();
    const databaseSchemaPath=String(pkg.databaseSchemaPath||pkg.releaseInfo?.databaseSchemaPath||'supabase/customer-schema.sql').trim();
    const databaseSchemaSha256=String(pkg.databaseSchemaSha256||pkg.releaseInfo?.databaseSchemaSha256||'').trim().toLowerCase();
    const databaseMigrationCount=Number(pkg.databaseMigrationCount??pkg.releaseInfo?.databaseMigrationCount??0);
    const databaseLatestMigration=String(pkg.databaseLatestMigration||pkg.releaseInfo?.databaseLatestMigration||'').trim();
    const schemaFile=files.find((file:any)=>String(file?.file||'')===databaseSchemaPath);
    const migrationChain=baseMigrationChainFromFiles(files);
    if(!databaseSchemaVersion||databaseSchemaPath!=='supabase/customer-schema.sql'||!/^[a-f0-9]{64}$/.test(databaseSchemaSha256)||!Number.isInteger(databaseMigrationCount)||databaseMigrationCount<1||!/^\d{14}$/.test(databaseLatestMigration)||schemaFile?.encoding!=='base64'||typeof schemaFile?.data!=='string'||!migrationChain.valid||migrationChain.rows.length!==databaseMigrationCount||migrationChain.rows.at(-1)?.id!==databaseLatestMigration)return null;
    const schemaBytes=Buffer.from(schemaFile.data,'base64');
    if(createHash('sha256').update(schemaBytes).digest('hex')!==databaseSchemaSha256)return null;
    const rawEngineProtocol=pkg.engineDeployerProtocol??pkg.releaseInfo?.engineDeployerProtocol;
    const declaredEngineProtocol=rawEngineProtocol===undefined?LEGACY_BASE_ENGINE_DEPLOYER_PROTOCOL:Number(rawEngineProtocol);
    if(!Number.isInteger(declaredEngineProtocol)||declaredEngineProtocol<1)return null;
    const engineDeployerProtocol=declaredEngineProtocol;
    return {databaseSchemaVersion,databaseSchemaPath,databaseSchemaSha256,databaseMigrationCount,databaseLatestMigration,databaseMigrations:migrationChain.rows,databaseRuntimeAccess:authoritativeDatabaseRuntimeAccess(),engineDeployerProtocol};
  }catch{return null;}
}
async function checkArtifact(row: any) {
  const checks: any[] = [];
  const expected = String(row.checksum || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/i.test(expected)) return { checks: [{ key: 'checksum', ok: false, message: 'A SHA-256 checksum is required.' }] };

  const repo = String(row.artifact_repo || row.source_repo || '').trim();
  const artifactName = String(row.artifact_name || '').trim();
  const artifactTag = String(row.manifest?.artifactTag || '').trim();
  if (!repo || !artifactName || (row.release_type==='base'&&!artifactTag)) return { checks: [{ key: 'artifact_reference', ok: false, message: row.release_type==='base' ? 'Base artifact repository, GitHub release tag and filename are required.' : 'Artifact repository and filename are missing.' }] };
  if(row.release_type==='base'&&artifactName!==`orbitfs-base-v${row.version}.json.gz`)return {checks:[{key:'artifact_reference',ok:false,message:`Base artifact filename must be orbitfs-base-v${row.version}.json.gz.`}]};

  const tokens = [...new Set([
    String(process.env[LOCAL_GITHUB_TOKEN_ENV] || '').trim(),
    String(process.env.GITHUB_RELEASE_TOKEN || '').trim(),
    String(process.env.GITHUB_TOKEN || '').trim(),
    ''
  ])];

  const githubFetch = async (url:string, accept:string) => {
    let lastStatus = 0;
    for (const token of tokens) {
      const headers = new Headers({ accept, 'user-agent': 'OrbitFS-License-Master/2', 'x-github-api-version': '2022-11-28' });
      if (token) headers.set('authorization', `Bearer ${token}`);
      const response = await fetch(url, { headers, redirect: 'follow', cache: 'no-store' });
      lastStatus = response.status;
      if (response.ok) return response;
      if (![401,403,404].includes(response.status)) return response;
    }
    return new Response(null,{status:lastStatus||404});
  };
  const downloadGithubAsset = async (apiUrl:string) => {
    const metadata = await githubFetch(apiUrl,'application/vnd.github+json');
    let browserUrl = '';
    if(metadata.ok){
      try{const value:any=await metadata.clone().json();browserUrl=String(value?.browser_download_url||'').trim();}catch{}
    }
    const apiDownload = await githubFetch(apiUrl,'application/octet-stream');
    if(apiDownload.ok)return apiDownload;
    if(browserUrl){
      const browserDownload=await githubFetch(browserUrl,'application/octet-stream');
      if(browserDownload.ok)return browserDownload;
      if(![401,403,404].includes(browserDownload.status))return browserDownload;
    }
    return apiDownload;
  };

  try {
    let assetUrl = String(row.artifact_url || '').trim();

    // Prefer resolving the current release asset from the recorded tag. This avoids
    // trusting a stale asset URL and proves the artifact still belongs to the
    // recorded GitHub release.
    if (artifactTag) {
      const releaseResponse = await githubFetch(
        `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(artifactTag)}`,
        'application/vnd.github+json'
      );
      if (releaseResponse.ok) {
        const release: any = await releaseResponse.json();
        const asset = Array.isArray(release.assets) ? release.assets.find((item: any) => String(item.name || '') === artifactName) : null;
        if (!asset?.url) return { checks: [{ key: 'artifact_reachable', ok: false, message: `GitHub release does not contain ${artifactName}.` }] };
        assetUrl = String(asset.url);
      } else if (!assetUrl) {
        return { checks: [{ key: 'artifact_reachable', ok: false, message: `GitHub release artifact could not be located (HTTP ${releaseResponse.status}). Check License Manager GitHub token Contents access to ${repo}.` }] };
      }
    }

    if (!assetUrl) return { checks: [{ key: 'artifact_reference', ok: false, message: 'Artifact tag or URL is missing.' }] };

    const response = /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/releases\/assets\/\d+$/.test(assetUrl)
      ? await downloadGithubAsset(assetUrl)
      : await githubFetch(assetUrl, 'application/octet-stream');
    if (!response.ok) return { checks: [{ key: 'artifact_reachable', ok: false, message: `Artifact returned HTTP ${response.status}. Check License Manager GitHub token Contents access to ${repo}.` }] };
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_ARTIFACT_BYTES) return { checks: [{ key: 'artifact_size', ok: false, message: `Artifact exceeds ${MAX_ARTIFACT_BYTES} bytes.` }] };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_ARTIFACT_BYTES) return { checks: [{ key: 'artifact_size', ok: false, message: `Artifact exceeds ${MAX_ARTIFACT_BYTES} bytes.` }] };
    const actual = createHash('sha256').update(bytes).digest('hex');
    const checksumMatches=actual===expected;
    const manifestPatch=checksumMatches?baseDatabaseManifestPatch(row,bytes):null;
    const scanRow=manifestPatch?{...row,manifest:{...(row.manifest||{}),...manifestPatch}}:row;
    checks.push({ key: 'artifact_reachable', ok: true, message: `Artifact downloaded (${bytes.length} bytes).` });
    checks.push({ key: 'checksum', ok: checksumMatches, message: checksumMatches ? 'SHA-256 checksum matches.' : 'SHA-256 checksum does not match the release record.' });
    checks.push(...await scanPackage(scanRow,bytes));
    return { checks, manifestPatch };
  } catch (error) {
    return { checks: [{ key: 'artifact_reachable', ok: false, message: error instanceof Error ? error.message : 'Artifact could not be downloaded.' }] };
  }
}
function enrichValidationChecks(checks:any[]){return checks.map((check:any)=>{if(check.ok)return check;const key=String(check.key||"validation");const fixes:any={product:"Activate or restore the release product in License Master.",version:"Provide a valid release version.",changelog:"Add the generated changelog/release notes before approval.",source:"Ensure source repository, ref and commit SHA are recorded.",components:"Correct the manifest component list for the release type.",manifest:"Provide a valid release manifest.",ci:"Fix the originating GitHub Actions build/run and submit the resulting candidate again.",artifact_reference:"Provide the canonical artifact repository, immutable GitHub release tag and exact filename. Base releases must use orbitfs-base-v<version>.json.gz; the workflow does not need to send an artifact URL.",checksum:"Generate the correct SHA-256 checksum for the exact artifact.",artifact_reachable:"Make the release artifact reachable from License Master without authentication that is unavailable to the validator.",artifact_size:"Reduce the release artifact to the supported size limit.",package_format:"Generate the supported OrbitFS .json.gz package format.",package_manifest:"Fix the package manifest structure and required release metadata.",package_paths:"Remove forbidden files or paths from the release package.",package_duplicates:"Remove duplicate paths from the release package.",package_version:"Make the package version match the License Manager release version.",package_source:"Make the package source commit match the recorded release source SHA.",package_files:"Regenerate the package file list/file count.",package_file_integrity:"Regenerate the package so every file size and SHA-256 matches its payload.",package_scan:"Fix the package parsing/structure error and regenerate the artifact.",package_engine_compatibility:"Regenerate the Engine artifact with a valid minimum Base version, deployer protocol and component list.",package_base_handoff:"Regenerate the Stage 1 handoff from the exact embedded Base package manifest; do not reconstruct file count, components, package format or Vercel project settings separately.",package_base_format:"Regenerate the Base artifact using orbitfs-base-deployment-v2 package schema 2.",database_schema_version:"Declare the customer database schema version separately as databaseSchemaVersion in both the Base artifact and License Manager release manifest.",database_migration_chain:"Package the complete immutable supabase/migrations chain and make databaseMigrationCount/databaseLatestMigration match the verified files.",database_migration_sequence_targets:"Correct any Base migration setval() call that targets a primary/unique constraint instead of a PostgreSQL sequence, then rebuild and republish the Base artifact.",package_update_schema:"Add a new immutable supabase/migrations/*.sql file and regenerate the Update Bundle so the orbitfs-db-migrations-v1 ids, sizes and SHA-256 checksums match the Engine payload.",package_update_sequence_targets:"Correct any setval() call that targets a primary/unique constraint instead of a PostgreSQL sequence, then regenerate the Update Bundle.",database_schema_sequence_targets:"Correct the generated customer database snapshot so every setval() call targets an actual PostgreSQL sequence, then rebuild and republish the Base artifact.",database_runtime_access_contract:"Regenerate and revalidate the Base release so License Manager can stamp the authoritative customer database runtime-access contract into the release manifest.",database_packages:"Build the release database package set from the exact source commit, submit those packages to License Manager, and include the returned package references in the release manifest."};const fix=fixes[key]||"Inspect the failing validation message and correct the underlying release data, artifact, or build issue.";return {...check,fix,prompt:"Fix the "+key+" validation failure shown above. Inspect the related release data, artifact, workflow or code, make the smallest production-safe change, then run the full License Master validation again. Do not change unrelated files."};});}

async function checkWorkflow(row: any) {
  const runId = Number(row.artifact_run_id || 0);
  const repo = String(row.artifact_repo || row.source_repo || '').trim();
  if (!runId || !repo || !repo.includes('/')) return { key: 'ci', ok: false, message: 'Release CI run metadata is missing.' };
  const headers = new Headers({ accept: 'application/vnd.github+json', 'user-agent': 'OrbitFS-License-Master/2', 'x-github-api-version': '2022-11-28' });
  const token = String(process.env[LOCAL_GITHUB_TOKEN_ENV] || process.env.GITHUB_RELEASE_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  if (token) headers.set('authorization', `Bearer ${token}`);
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}`, { headers, cache: 'no-store' });
    if (!response.ok) return { key: 'ci', ok: false, message: `GitHub Actions run could not be verified (HTTP ${response.status}).` };
    const run: any = await response.json();
    const jobsResponse = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`, { headers, cache: 'no-store' });
    if (!jobsResponse.ok) return { key: 'ci', ok: false, message: `GitHub Actions jobs could not be verified (HTTP ${jobsResponse.status}).` };
    const jobs: any = await jobsResponse.json();
    const candidates = Array.isArray(jobs.jobs) ? jobs.jobs.filter((job:any) => !/technical validation|license master technical validation/i.test(String(job.name || ''))) : [];
    const buildJob = candidates.find((job:any) => /build|publish|candidate/i.test(String(job.name || ''))) || candidates[0];
    const ok = Boolean(buildJob && buildJob.status === 'completed' && buildJob.conclusion === 'success');
    return { key: 'ci', ok, message: ok ? `GitHub Actions build job completed successfully (${buildJob.name}).` : buildJob ? `GitHub Actions build job is ${buildJob.status || 'unknown'} / ${buildJob.conclusion || 'unknown'}.` : `GitHub Actions run ${run.status || 'unknown'} / ${run.conclusion || 'unknown'} has no successful build job.` };
  } catch (error) {
    return { key: 'ci', ok: false, message: error instanceof Error ? error.message : 'Release CI could not be verified.' };
  }
}
export async function listReleases(includeArchived=false){const archive=includeArchived?'':'and r.archived_at is null';return(await db().query(`select r.*,p.slug product,p.name product_name from releases r join products p on p.id=r.product_id where r.source_repo = any($1::text[]) ${archive} order by r.created_at desc`,[[...LOCAL_SOURCE_REPOS]])).rows.map(withAuthoritativeReleaseRuntimeAccess);}
export async function getLatestRelease(productSlug:string,channel='stable',releaseType:'base'|'update'='update'){const expected=expectedReleaseSource(releaseType);const result=await db().query(`select r.id,r.version,r.channel,r.release_type,r.artifact_url,r.checksum,r.source_repo,r.source_ref,r.source_sha,r.artifact_name,r.artifact_repo,r.artifact_run_id,r.vercel_ready,r.supabase_ready,r.deployment_status,r.published_at,r.manifest,p.slug product from releases r join products p on p.id=r.product_id where p.slug=$1 and p.status='active' and r.channel=$2 and r.release_type=$3 and r.source_repo=$4 and r.status='published' and r.review_status='approved' order by r.published_at desc nulls last,r.created_at desc limit 1`,[productSlug,channel,releaseType,expected.repo]);return withAuthoritativeReleaseRuntimeAccess(result.rows[0]??null);}
export async function createRelease(input:{productId:string;channel:string;version:string;releaseType:'base'|'update';sourceRepo?:string|null;sourceRef?:string|null;artifactUrl?:string|null;checksum?:string|null;notes?:string|null;publish?:boolean;actorUserId?:string|null;actor?:string;reviewStatus?:'pending'|'approved'|'rejected';deploymentStatus?:'not_started'|'queued'|'deploying'|'deployed'|'failed';sourceSha?:string|null;artifactName?:string|null;artifactRepo?:string|null;artifactRunId?:number|null;vercelReady?:boolean;supabaseReady?:boolean;customerPublicationRepo?:string|null;manifest?:any;revision?:number;supersedesReleaseId?:string|null}){
 const pool=db();
 const expectedSource=expectedReleaseSource(input.releaseType);
 if(String(input.sourceRepo||'').trim()!==expectedSource.repo||String(input.sourceRef||'').trim()!==expectedSource.ref)throw new Error(`Release source must stay on this GitHub system: ${expectedSource.repo}@${expectedSource.ref}`);
 const expectedArtifactRepo=expectedReleaseArtifactRepo(input.releaseType);
 if(!releaseArtifactRepoAllowed(input.releaseType,input.artifactRepo))throw new Error(`Release artifact repository must stay on this GitHub system: ${expectedArtifactRepo}`);
 const settings=(await pool.query('select system_enabled,release_system_enabled,deployment_enabled from system_settings where id=true')).rows[0];
 if(!settings?.system_enabled||!settings.release_system_enabled||(input.releaseType==='base'&&!settings.deployment_enabled))throw new Error('Release/deployment system is offline');
 if(!isOrbitReleaseVersion(input.version))throw new Error('Invalid OrbitFS release version. Use a numeric version such as 1.0.0, v1.0.0.0, v.1.0.0, B0.0.0 or D.0.0.0.');
 await requireReleaseChannel(input.channel);
 const reviewStatus=input.reviewStatus??'pending';
 const publish=Boolean(input.publish&&reviewStatus==='approved');
 const incomingManifest={...(input.manifest||{}),components:canonicalComponents(input.manifest?.components,input.releaseType)};
 const existing=(await pool.query(
  `select * from releases
   where product_id=$1 and channel=$2 and version=$3 and release_type=$4 and source_repo=$5
   order by revision desc,created_at desc limit 1`,
  [input.productId,input.channel,input.version,input.releaseType,expectedSource.repo]
 )).rows[0];

 if(existing){
  const sameArtifact=Boolean(
   String(existing.checksum||'')&&String(input.checksum||'')&&String(existing.checksum)===String(input.checksum)&&
   String(existing.source_sha||'')===String(input.sourceSha||'')&&
   String(existing.artifact_repo||'')===String(input.artifactRepo||'')
  );
  if(existing.status==='published'&&sameArtifact)return existing;

  // A technical rejection hands the candidate back to Dev Panel. A new explicit
  // build for that same semantic version reuses the never-published candidate
  // instead of creating another rejected package revision.
  const returnedCandidate=existing.status==='draft'&&!existing.published_at&&existing.review_status==='rejected';
  const activeCandidate=existing.status==='draft'&&!existing.published_at&&(!existing.archived_at||returnedCandidate);
  if(activeCandidate){
   const attemptHistory=Array.isArray(existing.manifest?.build_attempts)?existing.manifest.build_attempts:[];
   const attemptNumber=Math.max(Number(existing.revision||0),Number(existing.manifest?.latest_attempt||0),...attemptHistory.map((item:any)=>Number(item?.attempt||0)),0)+1;
   const buildAttempt={
    attempt:attemptNumber,
    artifact_run_id:input.artifactRunId??null,
    artifact_repo:input.artifactRepo??null,
    source_sha:input.sourceSha??null,
    checksum:input.checksum??null,
    received_at:new Date().toISOString()
   };
   const manifest={...(existing.manifest||{}),...incomingManifest,build_attempts:[...attemptHistory,buildAttempt],latest_attempt:attemptNumber,package_revision:Number(existing.revision||1)};
   if(returnedCandidate&&manifest.review_handoff)manifest.review_handoff={...manifest.review_handoff,state:'retried',retried_at:new Date().toISOString(),retried_by:input.actor??'integration-api'};
   delete manifest.validation;
   manifest.validation_invalidated={reason:'new_build_attempt',at:new Date().toISOString(),artifact_run_id:input.artifactRunId??null,source_sha:input.sourceSha??null,checksum:input.checksum??null};
   const row=(await pool.query(
    `update releases set
      source_repo=$2,source_ref=$3,artifact_url=$4,checksum=$5,notes=$6,status='draft',published_at=null,
      review_status='pending',deployment_status=$7,source_sha=$8,artifact_name=$9,artifact_repo=$10,artifact_run_id=$11,
      vercel_ready=$12,supabase_ready=$13,customer_publication_repo=$14,manifest=$15,archived_at=null,archived_by=null
     where id=$1 returning *`,
    [existing.id,input.sourceRepo??existing.source_repo,input.sourceRef??existing.source_ref,input.artifactUrl??null,input.checksum??null,input.notes??null,input.deploymentStatus??'not_started',input.sourceSha??null,input.artifactName??null,input.artifactRepo??null,input.artifactRunId??null,input.vercelReady??false,input.supabaseReady??false,input.customerPublicationRepo??existing.customer_publication_repo??null,manifest]
   )).rows[0];
   await pool.query(
    `insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details)
     values($1,$2,'release.attempt.intake','release',$3,$4)`,
    [input.actorUserId??null,input.actor??'integration-api',row.id,JSON.stringify({version:input.version,release_type:input.releaseType,revision:Number(existing.revision||1),attempt:attemptNumber,artifact_run_id:input.artifactRunId??null})]
   );
   try{return await validateRelease(row.id,input.actorUserId??null,input.actor??'integration-api');}
   catch(error){
    const failedManifest={...manifest,validation:{status:'failed',checked_at:new Date().toISOString(),checks:[{key:'validation_runner',ok:false,message:error instanceof Error?error.message:'Automatic validation failed.'}]}};
    return (await pool.query('update releases set manifest=$2,status=\'draft\',review_status=\'pending\' where id=$1 returning *',[row.id,failedManifest])).rows[0];
   }
  }

  const nextRevision=Number((await pool.query(
   `select coalesce(max(revision),0)::int revision from releases where product_id=$1 and channel=$2 and version=$3 and release_type=$4 and source_repo=$5`,
   [input.productId,input.channel,input.version,input.releaseType,expectedSource.repo]
  )).rows[0].revision||0)+1;
  const receivedAt=new Date().toISOString();
  const previousAttempts=Array.isArray(existing.manifest?.build_attempts)?existing.manifest.build_attempts:[];
  const attemptNumber=Math.max(Number(existing.revision||0),Number(existing.manifest?.latest_attempt||0),...previousAttempts.map((item:any)=>Number(item?.attempt||0)),0)+1;
  const manifest={
   ...(existing.manifest||{}),
   ...incomingManifest,
   package_revision:nextRevision,
   latest_attempt:attemptNumber,
   repackage:{
    source_release_id:existing.id,
    source_revision:Number(existing.revision||1),
    source_status:String(existing.status||''),
    attempt:attemptNumber,
    created_at:receivedAt
   },
   build_attempts:[...previousAttempts,{
    attempt:attemptNumber,
    artifact_run_id:input.artifactRunId??null,
    artifact_repo:input.artifactRepo??null,
    source_sha:input.sourceSha??null,
    checksum:input.checksum??null,
    received_at:receivedAt
   }]
  };
  delete manifest.validation;
  delete manifest.validation_invalidated;
  delete manifest.rollback_from;
  delete manifest.rollback_source_release_id;
  const result=await pool.query(
   `insert into releases(product_id,channel,version,release_type,source_repo,source_ref,artifact_url,checksum,notes,status,published_at,review_status,deployment_status,source_sha,artifact_name,artifact_repo,artifact_run_id,vercel_ready,supabase_ready,customer_publication_repo,manifest,revision,supersedes_release_id)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',null,'pending',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning *`,
   [input.productId,input.channel,input.version,input.releaseType,input.sourceRepo??existing.source_repo,input.sourceRef??existing.source_ref,input.artifactUrl??null,input.checksum??null,input.notes??existing.notes??null,input.deploymentStatus??'not_started',input.sourceSha??null,input.artifactName??null,input.artifactRepo??null,input.artifactRunId??null,input.vercelReady??false,input.supabaseReady??false,input.customerPublicationRepo??existing.customer_publication_repo??null,manifest,nextRevision,existing.id]
  );
  const row=result.rows[0];
  await pool.query(
   `insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details)
    values($1,$2,'release.repackage.intake','release',$3,$4)`,
   [input.actorUserId??null,input.actor??'integration-api',row.id,JSON.stringify({version:input.version,release_type:input.releaseType,revision:nextRevision,attempt:attemptNumber,repackages_release_id:existing.id,previous_revision:Number(existing.revision||1),artifact_run_id:input.artifactRunId??null})]
  );
  try{return await validateRelease(row.id,input.actorUserId??null,input.actor??'integration-api');}
  catch(error){
   const failedManifest={...manifest,validation:{status:'failed',checked_at:new Date().toISOString(),checks:[{key:'validation_runner',ok:false,message:error instanceof Error?error.message:'Automatic validation failed.'}]}};
   return (await pool.query('update releases set manifest=$2,status=\'draft\',review_status=\'pending\' where id=$1 returning *',[row.id,failedManifest])).rows[0];
  }
 }

 const manifest={...incomingManifest,package_revision:input.revision??1,latest_attempt:1,build_attempts:[{attempt:1,artifact_run_id:input.artifactRunId??null,artifact_repo:input.artifactRepo??null,source_sha:input.sourceSha??null,checksum:input.checksum??null,received_at:new Date().toISOString()}]};
 const result=await pool.query(
  `insert into releases(product_id,channel,version,release_type,source_repo,source_ref,artifact_url,checksum,notes,status,published_at,review_status,deployment_status,source_sha,artifact_name,artifact_repo,artifact_run_id,vercel_ready,supabase_ready,customer_publication_repo,manifest,revision,supersedes_release_id)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) returning *`,
  [input.productId,input.channel,input.version,input.releaseType,input.sourceRepo??null,input.sourceRef??null,input.artifactUrl??null,input.checksum??null,input.notes??null,publish?'published':'draft',publish?new Date():null,reviewStatus,input.deploymentStatus??'not_started',input.sourceSha??null,input.artifactName??null,input.artifactRepo??null,input.artifactRunId??null,input.vercelReady??false,input.supabaseReady??false,input.customerPublicationRepo??null,manifest,input.revision??1,input.supersedesReleaseId??null]
 );
 const row=result.rows[0];
 await pool.query(
  `insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details)
   values($1,$2,'release.create','release',$3,$4)`,
  [input.actorUserId??null,input.actor??'integration-api',row.id,JSON.stringify({version:input.version,release_type:input.releaseType,revision:input.revision??1,review_status:reviewStatus,published:Boolean(publish),components:manifest.components||[],attempt:1})]
 );
 if(!publish&&row.id){
  try{return await validateRelease(row.id,input.actorUserId??null,input.actor??'integration-api');}
  catch(error){
   const failedManifest={...manifest,validation:{status:'failed',checked_at:new Date().toISOString(),checks:[{key:'validation_runner',ok:false,message:error instanceof Error?error.message:'Automatic validation failed.'}]}};
   return (await pool.query('update releases set manifest=$2,status=\'draft\',review_status=\'pending\' where id=$1 returning *',[row.id,failedManifest])).rows[0];
  }
 }
 return row;
}
async function validateSourceIdentity(row:any){
 const expected=expectedReleaseSource(row.release_type);
 const expectedArtifactRepo=expectedReleaseArtifactRepo(row.release_type);
 const sourceRepo=String(row.source_repo||'').trim(),ref=String(row.source_ref||'').trim(),sha=String(row.source_sha||'').trim(),artifactRepo=String(row.artifact_repo||'').trim();
 const ok=sourceRepo===expected.repo&&ref===expected.ref&&/^[a-f0-9]{40}$/i.test(sha)&&releaseArtifactRepoAllowed(row.release_type,artifactRepo);
 return {key:'source_identity',ok,message:ok?`Source identity is authoritative and system-local: ${sourceRepo}@${ref}; artifact ${artifactRepo} (${sha.slice(0,8)}).`:`Expected source ${expected.repo}@${expected.ref} and artifact repository ${expectedArtifactRepo}, with a full commit SHA.`};
}
async function validateUpdateBaseCompatibility(row:any){
 if(row.release_type!=='update')return {key:'minimum_base',ok:true,message:'Base compatibility check is not required for Base releases.'};
 const manifest=row.manifest&&typeof row.manifest==='object'?row.manifest:{};
 const minimumVersion=String(manifest.minimumBaseVersion||'').trim();
 const baseChannel=String(manifest.baseCompatibilityChannel||manifest.minimumBaseChannel||row.channel||'stable').trim().toLowerCase()||'stable';
 if(!isOrbitReleaseVersion(minimumVersion))return {key:'minimum_base',ok:false,message:'Update minimumBaseVersion is missing or invalid.'};
 const rows=(await db().query(`
  select r.id,r.version,r.channel,r.status,r.review_status,r.manifest,r.published_at,r.created_at
  from releases r join products p on p.id=r.product_id
  where p.slug='orbitfs_base'
    and r.release_type='base'
    and r.channel=$1
    and r.source_repo=$2
    and r.status='published'
    and r.review_status='approved'
    and r.archived_at is null
  order by r.published_at desc nulls last,r.created_at desc`,[baseChannel,LOCAL_BASE_REPO])).rows;
 const compatible=rows.filter((base:any)=>{
   const comparison=compareOrbitReleaseVersions(String(base.version||''),minimumVersion);
   return comparison!==null&&comparison>=0;
 }).sort((a:any,b:any)=>compareOrbitReleaseVersions(String(b.version||''),String(a.version||''))??0);
 const base=compatible[0];
 if(!base){
   const available=rows.map((candidate:any)=>String(candidate.version||'')).filter(Boolean);
   return {key:'minimum_base',ok:false,message:`No published + approved Base at or above minimum ${minimumVersion} exists in channel ${baseChannel}.${available.length?` Available published Base versions: ${available.join(', ')}.`:''}`};
 }
 return {key:'minimum_base',ok:true,message:`Minimum Base ${minimumVersion} is satisfied by published Base ${base.version} in ${baseChannel}.`};
}

async function validateVersionProgression(row:any){
 const version=String(row.version||'').trim();
 if(!isOrbitReleaseVersion(version))return {key:'version_progression',ok:false,message:'Release version is invalid. Use a numeric OrbitFS version such as 1.0.0, v1.0.0.0, v.1.0.0, B0.0.0 or D.0.0.0.'};
 const rollbackFrom=String(row?.manifest?.rollback_from?.release_id||'').trim();
 if(row.release_type==='base'&&rollbackFrom){
  const source=(await db().query(
   "select id,version,release_type,review_status,status,checksum,source_sha,manifest from releases where id=$1 and product_id=$2 and channel=$3 limit 1",
   [String(row?.manifest?.rollback_source_release_id||row?.manifest?.rollback_from?.source_release_id||''),row.product_id,row.channel]
  )).rows[0];
  const sourceValidated=Boolean(source&&source.release_type==='base'&&source.review_status==='approved'&&['superseded','published','disabled'].includes(String(source.status||''))&&source.manifest?.validation?.status==='passed'&&validationIdentityMatches(source));
  return {key:'version_progression',ok:sourceValidated,message:sourceValidated?`Rollback candidate deliberately restores validated Base ${version}; monotonic version progression is not required.`:'Rollback candidate does not reference a validated historical Base artifact.'};
 }

 const repackageSourceId=String(row?.manifest?.repackage?.source_release_id||'').trim();
 if(repackageSourceId){
  const source=(await db().query(
   "select id,product_id,channel,version,release_type,review_status,status,revision,checksum,source_sha,source_repo,published_at,manifest from releases where id=$1 and product_id=$2 and channel=$3 and release_type=$4 and version=$5 and source_repo=$6 limit 1",
   [repackageSourceId,row.product_id,row.channel,row.release_type,version,expectedReleaseSource(row.release_type).repo]
  )).rows[0];
  const sourceValidated=Boolean(
   source&&source.review_status==='approved'&&Boolean(source.published_at)&&
   ['published','superseded','withdrawn','disabled'].includes(String(source.status||''))&&
   source.manifest?.validation?.status==='passed'&&
   Number(row.revision||0)>Number(source.revision||0)&&
   String(row.supersedes_release_id||'')===String(source.id||'')
  );
  if(sourceValidated){
   const attempts=Array.isArray(row?.manifest?.build_attempts)?row.manifest.build_attempts:[];
   const attempt=Math.max(Number(row?.revision||1),Number(row?.manifest?.latest_attempt||0),...attempts.map((item:any)=>Number(item?.attempt||0)),1);
   return {key:'version_progression',ok:true,message:`Version ${version} remains the customer version. Attempt ${attempt} / package r${Number(row.revision||0)} is a valid same-version repackage of published r${Number(source.revision||0)}; customers adopt it only when this revision is approved and published.`};
  }
 }

 const family=orbitReleaseVersionFamily(version);
 const published=(await db().query(`
  select r.version
  from releases r
  where r.product_id=$1 and r.channel=$2 and r.release_type=$3
    and r.status='published' and r.review_status='approved'
    and r.source_repo=$5
    and r.archived_at is null and r.id<>$4
  order by r.published_at desc nulls last,r.created_at desc`,[row.product_id,row.channel,row.release_type,row.id,expectedReleaseSource(row.release_type).repo])).rows;
 const previous=published.find((candidate:any)=>orbitReleaseVersionFamily(candidate.version)===family);
 if(!previous)return {key:'version_progression',ok:true,message:`No previous published ${family||'OrbitFS'} ${row.release_type} version exists in ${row.channel}; ${version} starts that version line.`};
 const cmp=compareOrbitReleaseVersions(version,previous.version);
 const ok=cmp!==null&&cmp>0;
 return {key:'version_progression',ok,message:ok?`Version ${version} advances beyond published ${previous.version}.`:`Version ${version} must advance beyond the latest published ${family||'OrbitFS'} ${row.release_type} version ${previous.version} in ${row.channel}, unless it is a validated package revision of that same version.`};
}
export async function validateRelease(id:string, actorUserId?:string|null, actor?:string){const pool=db();const result=await pool.query(`select r.*,p.slug product,p.name product_name,p.status product_status from releases r join products p on p.id=r.product_id where r.id=$1 limit 1`,[id]);const row=result.rows[0];if(!row)return null;assertLocalReleaseRow(row);const checks:any[]=[];checks.push({key:'product',ok:row.product_status==='active',message:row.product_status==='active'?'Product is active.':'Product is not active.'});checks.push({key:'version',ok:isOrbitReleaseVersion(String(row.version||'').trim()),message:isOrbitReleaseVersion(String(row.version||'').trim())?'Version is a valid OrbitFS release version.':'Version must be a numeric OrbitFS release version (for example 1.0.0, v1.0.0.0, v.1.0.0, B0.0.0 or D.0.0.0).'});checks.push(await validateVersionProgression(row));const releaseNotes=String(row.notes||row.manifest?.releaseNotes||'').trim();checks.push({key:'changelog',ok:Boolean(releaseNotes),message:Boolean(releaseNotes)?'Generated release changelog is present.':'Release changelog is required before release approval.'});checks.push({key:'source',ok:Boolean(row.source_repo&&row.source_ref&&row.source_sha),message:Boolean(row.source_repo&&row.source_ref&&row.source_sha)?'Source repository, ref and commit are recorded.':'Source repository, ref and commit are required.'});checks.push(await validateSourceIdentity(row));checks.push(await validateUpdateBaseCompatibility(row));const components=canonicalComponents(row.manifest?.components,row.release_type);const componentsOk=row.release_type==='base'?components.length===1&&components[0]==='base':components.length>0&&components.every((x:string)=>ALLOWED_UPDATE_COMPONENTS.has(x));checks.push({key:'components',ok:componentsOk,message:componentsOk?`Release components: ${components.join(', ')}.`:'Release components are missing or invalid.'});const manifestObject=row.manifest&&typeof row.manifest==='object'?row.manifest:{};checks.push({key:'manifest',ok:Object.keys(manifestObject).length>0,message:Object.keys(manifestObject).length>0?'Release manifest is present.':'Release manifest is missing.'});const databasePackages=await validateReleaseDatabasePackages(row);checks.push({key:'database_packages',ok:databasePackages.ok,message:databasePackages.message});const workflow=await checkWorkflow(row);checks.push(workflow);const artifact=await checkArtifact(row);checks.push(...artifact.checks);if(row.release_type==='base'){const contract=artifact.manifestPatch?.databaseRuntimeAccess;const contractOk=Boolean(contract&&Number(contract.version)===1&&contract.schema==='public'&&contract.publishableRole==='anon'&&contract.authenticatedRole==='authenticated'&&contract.serviceRole==='service_role'&&Array.isArray(contract.publicReadTables)&&contract.publicReadTables.includes('orbitfs_addons')&&Array.isArray(contract.authenticatedReadTables)&&contract.authenticatedReadTables.includes('orbitfs_addons')&&Array.isArray(contract.serverFullAccessTables)&&['orbitfs_addons','orbitfs_schema_migrations'].every((table)=>contract.serverFullAccessTables.includes(table))&&Array.isArray(contract.restPreflightTables)&&contract.restPreflightTables.includes('orbitfs_addons')&&Array.isArray(contract.serverPreflightTables)&&contract.serverPreflightTables.includes('orbitfs_schema_migrations')&&contract.runtimeSecretHeader==='x-orbitfs-secret'&&Array.isArray(contract.runtimeSecretRoles)&&['anon','authenticated'].every((role)=>contract.runtimeSecretRoles.includes(role))&&Array.isArray(contract.runtimeSecretTablePrefixes)&&['orbitfs_','mcp_','studio_','apex_'].every((prefix)=>contract.runtimeSecretTablePrefixes.includes(prefix))&&Array.isArray(contract.runtimeSecretExcludedTables)&&contract.runtimeSecretExcludedTables.includes('orbitfs_schema_migrations')&&contract.runtimeSecretExcludedTables.includes('orbitfs_runtime_secret_probe')&&Array.isArray(contract.runtimeSecretPreflightTables)&&['orbitfs_addons','orbitfs_users','orbitfs_workspaces'].every((table)=>contract.runtimeSecretPreflightTables.includes(table))&&contract.runtimeSecretRepairRpc==='orbitfs_repair_runtime_access'&&contract.runtimeSecretProbeTable==='orbitfs_runtime_secret_probe');checks.push({key:'database_runtime_access_contract',ok:contractOk,message:contractOk?'Base release carries the License Manager runtime database access contract for publishable, authenticated and service-role access.':'Base release is missing the authoritative runtime database access contract required by the customer deployer.'});}const enrichedChecks=enrichValidationChecks(checks);const passed=enrichedChecks.every((x:any)=>x.ok===true);const manifest=validationManifest({...row,manifest:{...(row.manifest||{}),...(artifact.manifestPatch||{}),components}},enrichedChecks,passed?'passed':'failed');const saved=(await pool.query(`update releases set manifest=$2 where id=$1 returning *`,[id,manifest])).rows[0];await pool.query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'release.validate','release',$3,$4)`,[actorUserId??null,actor??'integration-api',id,JSON.stringify({status:passed?'passed':'failed',checks:enrichedChecks})]);if(passed&&saved?.status==='draft'&&!saved?.archived_at&&saved?.review_status==='pending'){const settings=(await pool.query('select system_enabled,release_system_enabled,auto_technical_approval_enabled from system_settings where id=true')).rows[0];if(settings?.system_enabled===true&&settings?.release_system_enabled===true&&settings?.auto_technical_approval_enabled===true){const approved=await setReleaseReview(id,'approved',actorUserId??null,'license-manager:auto-technical-approval','Automatic technical approval after every required License Manager validation check passed for the exact source/artifact.');if(approved)return approved;}}return saved;}
export async function setReleaseReview(id:string,reviewStatus:'approved'|'rejected',actorUserId?:string|null,actor?:string,reason?:string){
 const pool=db();
 const row=(await pool.query(`select * from releases where id=$1`,[id])).rows[0];
 if(!row)return null;
 assertLocalReleaseRow(row);
 if(row.status==='published')throw new Error('Published releases are immutable; unpublish them before returning them to Dev Panel.');
 if(reviewStatus==='approved'&&(row.manifest?.validation?.status!=='passed'||!validationIdentityMatches(row)))throw new Error('Release must pass validation for this exact source/artifact before approval');
 const now=new Date();
 const reasonText=String(reason||'').trim()||null;

 // A release that has already been customer-published is immutable history.
 // Returning it to Dev therefore creates a never-published rejected revision
 // that Dev Panel can safely reuse for the next Stage 1 build.
 if(reviewStatus==='rejected'&&row.published_at){
  const existingReturned=(await pool.query(
   `select * from releases
    where supersedes_release_id=$1
      and product_id=$2 and channel=$3 and version=$4 and release_type=$5 and source_repo=$6
      and published_at is null and review_status='rejected'
      and manifest->'review_handoff'->>'state'='returned_to_dev'
    order by revision desc,created_at desc limit 1`,
   [row.id,row.product_id,row.channel,row.version,row.release_type,row.source_repo]
  )).rows[0];
  if(existingReturned)return existingReturned;

  const nextRevision=Number((await pool.query(
   `select coalesce(max(revision),0)::int revision
    from releases
    where product_id=$1 and channel=$2 and version=$3 and release_type=$4 and source_repo=$5`,
   [row.product_id,row.channel,row.version,row.release_type,row.source_repo]
  )).rows[0].revision||0)+1;
  const manifest={
   ...(row.manifest||{}),
   package_revision:nextRevision,
   review_handoff:{
    state:'returned_to_dev',
    reason:reasonText,
    rejected_at:now.toISOString(),
    actor:actor??'admin',
    source_release_id:row.id,
    source_revision:Number(row.revision||1),
    source_status:String(row.status||'withdrawn'),
    previously_published:true
   }
  };
  const returned=(await pool.query(
   `insert into releases(
      product_id,channel,version,release_type,source_repo,source_ref,artifact_url,checksum,notes,
      status,published_at,review_status,deployment_status,source_sha,artifact_name,artifact_repo,artifact_run_id,
      vercel_ready,supabase_ready,customer_publication_repo,manifest,revision,supersedes_release_id
    ) values(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,
      'draft',null,'rejected','not_started',$10,$11,$12,$13,
      $14,$15,$16,$17,$18,$19
    ) returning *`,
   [row.product_id,row.channel,row.version,row.release_type,row.source_repo,row.source_ref,row.artifact_url,row.checksum,row.notes,
    row.source_sha,row.artifact_name,row.artifact_repo,row.artifact_run_id,row.vercel_ready,row.supabase_ready,row.customer_publication_repo,
    manifest,nextRevision,row.id]
  )).rows[0];
  await pool.query(
   `insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details)
    values($1,$2,'release.review','release',$3,$4)`,
   [actorUserId??null,actor??'admin',returned.id,JSON.stringify({
    review_status:'rejected',reason:reasonText,handed_back_to_dev:true,
    returned_from_release_id:row.id,previously_published:true,revision:nextRevision
   })]
  );
  return returned;
 }

 const manifest={...(row.manifest||{})};
 if(reviewStatus==='rejected'){
  manifest.review_handoff={state:'returned_to_dev',reason:reasonText,rejected_at:now.toISOString(),actor:actor??'admin'};
 }else if(manifest.review_handoff){
  manifest.review_handoff={...manifest.review_handoff,state:'resolved',resolved_at:now.toISOString(),resolved_by:actor??'admin'};
 }
 const result=await pool.query(
  `update releases set review_status=$2,
    status=case when $2='rejected' then 'draft' when status='disabled' then 'draft' else status end,
    archived_at=case when $2='rejected' then null else archived_at end,
    archived_by=case when $2='rejected' then null else archived_by end,
    manifest=$3
   where id=$1 returning *`,
  [id,reviewStatus,manifest]
 );
 if(!result.rows[0])return null;
 await pool.query(
  `insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,$3,'release',$4,$5)`,
  [actorUserId??null,actor??'admin','release.review',id,JSON.stringify({review_status:reviewStatus,reason:reasonText,handed_back_to_dev:reviewStatus==='rejected'})]
 );
 return result.rows[0];
}
export async function publishRelease(id:string,actorUserId?:string|null,actor?:string){
 const pool=db();
 const settings=(await pool.query('select system_enabled,release_system_enabled,deployment_enabled from system_settings where id=true')).rows[0];
 if(!settings?.system_enabled||!settings.release_system_enabled||!settings.deployment_enabled)throw new Error('Release/deployment system is offline');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const row=(await client.query('select * from releases where id=$1 for update',[id])).rows[0];
  if(!row){await client.query('ROLLBACK');return null;}
  assertLocalReleaseRow(row);
  const channel=await requireReleaseChannel(row.channel);
  if(!channel.customer_visible)throw new Error('Release channel is not customer-visible and cannot be published.');
  if(row.status!=='draft'||row.archived_at)throw new Error('Only an active draft release can be published. Superseded, withdrawn and archived history is immutable.');
  if(row.review_status!=='approved')throw new Error('Release must be approved before publication');
  if(row.manifest?.validation?.status!=='passed'||!validationIdentityMatches(row))throw new Error('Release must pass validation for this exact source/artifact before publication');

  let superseded:any[]=[];
  let archivedHistory:any[]=[];
  let immediatePrevious:any=null;

  // Base publication exposes one current release and one previous rollback release.
  // Update versions remain independently published, but a newer package revision of
  // the same Update version supersedes older package revisions of that exact version.
  if(row.release_type==='base'){
   await client.query('select pg_advisory_xact_lock(hashtext($1))',[String(row.product_id)+':'+String(row.channel)+':base']);
   const currentlyPublished=(await client.query(
    "select id,version,published_at from releases where product_id=$1 and channel=$2 and release_type='base' and source_repo=$4 and status='published' and id<>$3 order by published_at desc nulls last,created_at desc for update",
    [row.product_id,row.channel,id,row.source_repo]
   )).rows;
   immediatePrevious=currentlyPublished[0]||null;

   if(currentlyPublished.length){
    superseded=(await client.query(
     "update releases set status='superseded',archived_at=case when id=$2::uuid then null else coalesce(archived_at,now()) end,archived_by=case when id=$2::uuid then null else coalesce(archived_by,$3::uuid) end where id = any($1::uuid[]) returning id,version,published_at,archived_at",
     [currentlyPublished.map((item:any)=>item.id),immediatePrevious?.id??null,actorUserId??null]
    )).rows;
   }

   archivedHistory=(await client.query(
    "update releases set archived_at=coalesce(archived_at,now()),archived_by=coalesce(archived_by,$3::uuid) where product_id=$1 and channel=$2 and release_type='base' and source_repo=$5 and status='superseded' and archived_at is null and ($4::uuid is null or id<>$4::uuid) returning id,version,published_at,archived_at",
    [row.product_id,row.channel,actorUserId??null,immediatePrevious?.id??null,row.source_repo]
   )).rows;
  }else if(row.release_type==='update'){
   await client.query('select pg_advisory_xact_lock(hashtext($1))',[String(row.product_id)+':'+String(row.channel)+':update:'+String(row.version)]);
   const sameVersionPublished=(await client.query(
    "select id,version,published_at,revision from releases where product_id=$1 and channel=$2 and release_type='update' and version=$3 and source_repo=$5 and status='published' and id<>$4 order by revision desc,published_at desc nulls last,created_at desc for update",
    [row.product_id,row.channel,row.version,id,row.source_repo]
   )).rows;
   immediatePrevious=sameVersionPublished[0]||null;
   if(sameVersionPublished.length){
    superseded=(await client.query(
     "update releases set status='superseded' where id = any($1::uuid[]) returning id,version,published_at,archived_at",
     [sameVersionPublished.map((item:any)=>item.id)]
    )).rows;
   }
  }

  const databasePackages=await publishReleaseDatabasePackages(client,row,actorUserId,actor);

  const result=await client.query(
   "update releases set status='published',review_status='approved',published_at=now(),deployment_status='queued',supersedes_release_id=coalesce(supersedes_release_id,$2::uuid) where id=$1 and review_status='approved' returning *",
   [id,immediatePrevious?.id??null]
  );
  const published=result.rows[0];
  if(!published){await client.query('ROLLBACK');return null;}

  for(const previous of superseded){
   await client.query(
    "insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'release.superseded','release',$3,$4)",
    [actorUserId??null,actor??'admin',previous.id,JSON.stringify({superseded_by:id,version:previous.version,channel:row.channel,release_type:row.release_type,archived:Boolean(previous.archived_at),rollback_slot:row.release_type==='base'&&String(previous.id)===String(immediatePrevious?.id||''),same_version_revision:String(previous.version)===String(row.version)})]
   );
  }
  for(const historical of archivedHistory){
   await client.query(
    "insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'release.history.hidden','release',$3,$4)",
    [actorUserId??null,actor??'admin',historical.id,JSON.stringify({new_current_release_id:id,version:historical.version,channel:row.channel,release_type:'base',preserve_audit_history:true})]
   );
  }
  await client.query(
   "insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'release.publish','release',$3,$4)",
   [actorUserId??null,actor??'admin',id,JSON.stringify({deployment_status:'queued',previous_release_id:immediatePrevious?.id??null,superseded_release_ids:superseded.map((x:any)=>x.id),hidden_history_ids:archivedHistory.map((x:any)=>x.id),database_packages:databasePackages})]
  );
  await client.query('COMMIT');
  return published;
 }catch(error){
  try{await client.query('ROLLBACK')}catch{}
  throw error;
 }finally{client.release();}
}
export async function promoteRelease(id:string,targetChannel:string,actorUserId?:string|null,actor?:string){
 const pool=db();
 const source=(await pool.query(`select r.*,p.slug product from releases r join products p on p.id=r.product_id where r.id=$1 limit 1`,[id])).rows[0];
 if(!source) return null;
 assertLocalReleaseRow(source);
 if(source.review_status!=='approved'||source.manifest?.validation?.status!=='passed') throw new Error('Only a technically approved and validated release can be promoted.');
 const channel=await requireReleaseChannel(targetChannel);
 if(channel.channel===source.channel) throw new Error('Target channel is the same as the source channel.');
 if(!channel.customer_visible)throw new Error('Target release channel is not customer-visible.');
 if(source.release_type==='update'){
  const compatibility=await validateUpdateBaseCompatibility({...source,channel:channel.channel});
  if(!compatibility.ok)throw new Error(compatibility.message);
 }
 const progression=await validateVersionProgression({...source,channel:channel.channel,id:'00000000-0000-0000-0000-000000000000'});
 if(!progression.ok)throw new Error(progression.message);
 const existing=(await pool.query(`select * from releases where product_id=$1 and channel=$2 and version=$3 and release_type=$4 and artifact_url=$5 and checksum=$6 and source_sha=$7 and source_repo=$8 order by revision desc limit 1`,[source.product_id,channel.channel,source.version,source.release_type,source.artifact_url,source.checksum,source.source_sha,source.source_repo])).rows[0];
 if(existing) return existing;
 const revision=Number((await pool.query(`select coalesce(max(revision),0)::int revision from releases where product_id=$1 and channel=$2 and version=$3 and release_type=$4 and source_repo=$5`,[source.product_id,channel.channel,source.version,source.release_type,source.source_repo])).rows[0].revision||0)+1;
 const manifest={...(source.manifest||{}),promoted_from:{release_id:source.id,channel:source.channel,promoted_at:new Date().toISOString()}};
 // Promotion is not a new technical candidate. The source has already passed License
 // Master validation/approval, so the promoted release preserves that approval and
 // validation state. Publication remains a separate customer-facing action.
 const result=await pool.query(`insert into releases(product_id,channel,version,release_type,source_repo,source_ref,artifact_url,checksum,notes,status,published_at,review_status,deployment_status,source_sha,artifact_name,artifact_repo,artifact_run_id,vercel_ready,supabase_ready,customer_publication_repo,manifest,revision,supersedes_release_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'approved',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) returning *`,
 [source.product_id,channel.channel,source.version,source.release_type,source.source_repo,source.source_ref,source.artifact_url,source.checksum,source.notes,
  'draft',null,'not_started',
  source.source_sha,source.artifact_name,source.artifact_repo,source.artifact_run_id,source.vercel_ready,source.supabase_ready,source.customer_publication_repo,manifest,revision,source.id]);
 const row=result.rows[0];
 await pool.query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'release.promote','release',$3,$4)`,[actorUserId??null,actor??'admin',row.id,JSON.stringify({from_release_id:source.id,from_channel:source.channel,to_channel:channel.channel,version:row.version,approval_preserved:true,publication_required:true})]);
 return row;
}

export async function createPresentationRevision(id:string,input:any,actorUserId?:string|null,actor?:string){
 const pool=db();
 const source=(await pool.query('select * from releases where id=$1 limit 1',[id])).rows[0];
 if(!source)return null;
 assertLocalReleaseRow(source);
 if(source.status!=='published')throw new Error('Only a published release can create a presentation revision.');
 const revision=Number((await pool.query('select coalesce(max(revision),0)::int revision from releases where product_id=$1 and channel=$2 and version=$3 and release_type=$4 and source_repo=$5',[source.product_id,source.channel,source.version,source.release_type,source.source_repo])).rows[0].revision||0)+1;
 const manifest={...(source.manifest||{})};
 for(const [key,value] of Object.entries(input||{})){if(['title','description','customer_notes','internal_notes','severity','required','rollout','minimum_version','rollback_version'].includes(key))manifest[key]=value;}
 if(input?.changelog!==undefined)manifest.customer_changelog=String(input.changelog||'');
 const result=await pool.query(`insert into releases(product_id,channel,version,release_type,source_repo,source_ref,artifact_url,checksum,notes,status,published_at,review_status,deployment_status,source_sha,artifact_name,artifact_repo,artifact_run_id,vercel_ready,supabase_ready,customer_publication_repo,manifest,revision,supersedes_release_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',null,'approved',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) returning *`,
 [source.product_id,source.channel,source.version,source.release_type,source.source_repo,source.source_ref,source.artifact_url,source.checksum,source.notes,source.deployment_status||'not_started',source.source_sha,source.artifact_name,source.artifact_repo,source.artifact_run_id,source.vercel_ready,source.supabase_ready,source.customer_publication_repo,manifest,revision,source.id]);
 const row=result.rows[0];
 await pool.query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'release.presentation.revision','release',$3,$4)`,[actorUserId??null,actor??'admin',row.id,JSON.stringify({supersedes_release_id:source.id,version:row.version,revision})]);
 return row;
}

export async function withdrawRelease(id:string,actorUserId?:string|null,actor?:string){
 const pool=db();
 const row=(await pool.query('select * from releases where id=$1 limit 1',[id])).rows[0];
 if(!row)return null;
 assertLocalReleaseRow(row);
 if(row.status!=='published')throw new Error('Only a published release can be withdrawn.');
 const result=await pool.query("update releases set status='withdrawn' where id=$1 and status='published' returning *",[id]);
 if(!result.rows[0])throw new Error('Release could not be withdrawn.');
 await pool.query("insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'release.withdraw','release',$3,$4)",[actorUserId??null,actor??'admin',id,JSON.stringify({version:row.version,channel:row.channel,release_type:row.release_type})]);
 return result.rows[0];
}

export async function rollbackBaseRelease(id:string,actorUserId?:string|null,actor?:string){
 const pool=db();
 const current=(await pool.query('select r.*,p.slug product from releases r join products p on p.id=r.product_id where r.id=$1 limit 1',[id])).rows[0];
 if(!current)return null;
 assertLocalReleaseRow(current);
 if(current.release_type!=='base')throw new Error('Rollback is currently available for Base deployments only.');
 if(current.status!=='published')throw new Error('Only a published Base deployment can be rolled back.');
 const previous=(await pool.query(
  "select r.*,p.slug product from releases r join products p on p.id=r.product_id where r.product_id=$1 and r.channel=$2 and r.release_type='base' and r.source_repo=$5 and r.status in ('superseded','published','disabled') and r.review_status='approved' and r.id<>$3 and r.published_at < $4 order by r.published_at desc nulls last,r.created_at desc limit 1",
  [current.product_id,current.channel,id,current.published_at,current.source_repo]
 )).rows[0];
 if(!previous||previous.manifest?.validation?.status!=='passed'||!validationIdentityMatches(previous))throw new Error('No previous validated Base deployment is available for rollback.');
 const revision=Number((await pool.query('select coalesce(max(revision),0)::int revision from releases where product_id=$1 and channel=$2 and version=$3 and release_type=\'base\' and source_repo=$4',[previous.product_id,previous.channel,previous.version,previous.source_repo])).rows[0].revision||0)+1;
 const manifest={...(previous.manifest||{}),rollback_from:{release_id:current.id,version:current.version,source_release_id:previous.id,created_at:new Date().toISOString()},rollback_source_release_id:previous.id};
 const result=await pool.query("insert into releases(product_id,channel,version,release_type,source_repo,source_ref,artifact_url,checksum,notes,status,published_at,review_status,deployment_status,source_sha,artifact_name,artifact_repo,artifact_run_id,vercel_ready,supabase_ready,customer_publication_repo,manifest,revision,supersedes_release_id) values($1,$2,$3,'base',$4,$5,$6,$7,$8,'draft',null,'pending','not_started',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning *",[previous.product_id,previous.channel,previous.version,previous.source_repo,previous.source_ref,previous.artifact_url,previous.checksum,previous.notes,previous.source_sha,previous.artifact_name,previous.artifact_repo,previous.artifact_run_id,previous.vercel_ready,previous.supabase_ready,previous.customer_publication_repo,manifest,revision,current.id]);
 const row=result.rows[0];
 await pool.query("insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'release.rollback.prepare','release',$3,$4)",[actorUserId??null,actor??'admin',row.id,JSON.stringify({from_release_id:current.id,from_version:current.version,to_version:row.version,source_release_id:previous.id})]);
 return validateRelease(row.id,actorUserId??null,actor??'admin');
}

export async function archiveRelease(id:string, archived:boolean, actorUserId?:string|null, actor?:string, reason?:string){const pool=db();const row=(await pool.query(`select * from releases where id=$1`,[id])).rows[0];if(!row)return null;assertLocalReleaseRow(row);if(archived&&row.status==='published')throw new Error('Published releases must be withdrawn before they can be archived.');if(!archived&&row.status==='published')throw new Error('Published releases cannot be restored into the active deployment queue.');const now=new Date();const manifest={...(row.manifest||{})};if(archived)manifest.archive={...(manifest.archive||{}),reason:String(reason||'Archived from Dev Panel').trim(),archived_at:now.toISOString(),actor:actor??'admin'};else delete manifest.archive;const result=await pool.query(`update releases set archived_at=$2,archived_by=$3,manifest=$4 where id=$1 returning *`,[id,archived?now:null,archived?actorUserId??null:null,manifest]);await pool.query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,$3,'release',$4,$5)`,[actorUserId??null,actor??'admin',archived?'release.archive':'release.restore',id,JSON.stringify({archived,reason:archived?String(reason||'Archived from Dev Panel').trim():null})]);return result.rows[0]??null;}

export async function markReleaseRolledBack(id:string,reason:string,actorUserId?:string|null,actor?:string,kind:'rollback'|'revert'='rollback'){
 const pool=db();const row=(await pool.query('select * from releases where id=$1 limit 1',[id])).rows[0];if(!row)return null;assertLocalReleaseRow(row);
 const why=String(reason||'').trim();if(!why)throw new Error('Rollback/revert reason is required.');
 const now=new Date();const manifest={...(row.manifest||{}),lifecycle:{...(row.manifest?.lifecycle||{}),state:kind==='revert'?'reverted':'rolled_back',reason:why,at:now.toISOString(),actor:actor??'dev-panel'}};
 if(row.status==='published')await pool.query("update releases set status='withdrawn' where id=$1 and status='published'",[id]);
 const result=(await pool.query("update releases set status='withdrawn',archived_at=$2,archived_by=$3,manifest=$4 where id=$1 returning *",[id,now,actorUserId??null,manifest])).rows[0];
 await pool.query("insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,$3,'release',$4,$5)",[actorUserId??null,actor??'dev-panel',kind==='revert'?'release.reverted':'release.rolled_back',id,JSON.stringify({version:row.version,release_type:row.release_type,previous_status:row.status,reason:why})]);
 return result??null;
}
export async function updateReleasePresentation(id:string,input:any,actorUserId?:string|null,actor?:string){const pool=db();const row=(await pool.query(`select * from releases where id=$1`,[id])).rows[0];if(!row)return null;assertLocalReleaseRow(row);if(row.status==='published')throw new Error('Published releases are immutable; create a new revision for changes.');const oldManifest=row.manifest||{};const nextManifest={...oldManifest};for(const [key,value] of Object.entries(input||{})){if(['title','description','customer_notes','internal_notes','severity','required','rollout','minimum_version','rollback_version'].includes(key))nextManifest[key]=value;}if(input?.changelog!==undefined)nextManifest.customer_changelog=String(input.changelog||'');const result=await pool.query(`update releases set manifest=$2 where id=$1 returning *`,[id,nextManifest]);await pool.query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'release.presentation.update','release',$3,$4)`,[actorUserId??null,actor??'admin',id,JSON.stringify({fields:Object.keys(input||{}),technical_validation_preserved:true})]);return result.rows[0]??null;}