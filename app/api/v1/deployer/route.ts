import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../lib/auth';
import {db} from '../../../../lib/db';
import {generateInstallationCredential,hashLicenseCredential,recordInstallationCheckIn} from '../../../../lib/core/licenses';
import {compareOrbitReleaseVersions} from '../../../../lib/core/versioning';

function requestIp(request:Request){return request.headers.get('x-real-ip')?.trim()||request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||null;}

export async function GET(request:Request){
  const actor=await integrationAuthorized(request,'deployment.read');
  if(!actor)return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});
  const u=new URL(request.url);
  const installationId=String(u.searchParams.get('installation_id')||u.searchParams.get('installationId')||'').trim();
  const licenseId=String(u.searchParams.get('license_id')||u.searchParams.get('licenseId')||'').trim();
  if(!installationId)return NextResponse.json({ok:false,code:'INSTALLATION_ID_REQUIRED'},{status:400});
  const params:any[]=[installationId];
  const licenseFilter=licenseId?' and a.license_id=$2':'';
  if(licenseId)params.push(licenseId);
  const activation=(await db().query(
    `select a.id,a.license_id,a.installation_id,a.status,a.product_version,a.first_seen_at,a.last_seen_at,a.last_ip,a.last_user_agent,a.last_hostname,a.last_platform,a.last_architecture,a.last_client,a.last_client_version,a.last_provider,a.last_region,a.last_deployment_id,a.last_deployment_url,a.last_deployment_status,a.last_operation,a.deployment_count,a.current_components,a.metadata->'panel_domain' panel_domain,coalesce((a.metadata->'deployment_lock'->>'locked')::boolean,false) deployment_locked,nullif(a.metadata->'deployment_lock'->>'reason','') deployment_lock_reason,nullif(a.metadata->'deployment_lock'->>'changed_at','') deployment_lock_changed_at,nullif(a.metadata->'deployment_lock'->>'changed_by','') deployment_lock_changed_by,l.status license_status,l.expires_at license_expires_at,p.slug product
     from activations a
     join licenses l on l.id=a.license_id
     join products p on p.id=l.product_id
     where a.installation_id=$1${licenseFilter}
     order by a.last_seen_at desc nulls last,a.created_at desc
     limit 1`,params
  )).rows[0]||null;
  if(!activation)return NextResponse.json({ok:false,code:'INSTALLATION_NOT_FOUND'},{status:404});
  const events=(await db().query(
    `select e.id,e.release_id,e.action,e.phase,e.product,e.product_version,e.previous_version,e.deployment_id,e.deployment_url,e.project_id,e.project_name,e.provider,e.region,e.platform,e.hostname,e.client,e.client_version,e.details,e.created_at,r.version release_version,r.channel release_channel,r.release_type,r.status release_status,r.review_status
     from deployment_events e
     left join releases r on r.id=e.release_id
     where e.installation_id=$1 and e.license_id=$2
     order by e.created_at desc
     limit 50`,[installationId,activation.license_id]
  )).rows;
  const completedBase=events.find((e:any)=>e.phase==='completed'&&['deploy','base_update','redeploy','rollback'].includes(String(e.action))&&String(e.details?.rollbackScope||'base')==='base')||null;
  const completedUpdate=events.find((e:any)=>e.phase==='completed'&&e.action==='update')||null;
  return NextResponse.json({ok:true,authority:'orbitfs-license-master-v2',installation:{...activation,current_base:completedBase,current_update:completedUpdate,recent_events:events}});
}
export async function POST(request:Request){
  const actor=await integrationAuthorized(request,'deployment.write');
  if(!actor)return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});
  const body=await request.json().catch(()=>null);
  const action=String(body?.action||'deploy').toLowerCase();
  const phase=String(body?.phase||'authorize').toLowerCase();
  const releaseId=String(body?.releaseId||body?.release_id||'').trim();
  const installationId=String(body?.installationId||body?.installation_id||'').trim();
  const rollbackScope=String(body?.rollbackScope||body?.rollback_scope||'base').trim().toLowerCase();
  const updateRollback=action==='rollback'&&rollbackScope==='update';
  if(action==='register_runtime'){
    const licenseId=String(body?.licenseId||body?.license_id||'').trim();
    if(!installationId)return NextResponse.json({ok:false,code:'INSTALLATION_ID_REQUIRED'},{status:400});
    if(!licenseId)return NextResponse.json({ok:false,code:'LICENSE_ID_REQUIRED'},{status:400});
    const settings=(await db().query('select system_enabled,licensing_enabled,maintenance_mode,validation_ttl_seconds,offline_grace_seconds,pulse_poll_seconds,max_failed_validations,allow_offline_grace,pulse_revision,pulse_at,pulse_reason from system_settings where id=true')).rows[0];
    if(!settings?.system_enabled||!settings?.licensing_enabled||settings?.maintenance_mode)return NextResponse.json({ok:false,code:'AUTHORITY_UNAVAILABLE'},{status:503});
    const license=(await db().query(`select l.id,l.status,l.expires_at,l.metadata,p.slug component,p.status product_status from licenses l join products p on p.id=l.product_id where l.id=$1 limit 1`,[licenseId])).rows[0];
    if(!license||license.component!=='orbitfs_base'||license.product_status!=='active')return NextResponse.json({ok:false,code:'LICENSE_NOT_ELIGIBLE'},{status:403});
    if(license.status!=='active'||(license.expires_at&&new Date(license.expires_at).getTime()<=Date.now()))return NextResponse.json({ok:false,code:'LICENSE_NOT_ELIGIBLE'},{status:403});
    const rotationRequired=license.metadata&&typeof license.metadata==='object'&&license.metadata.base_reinstall_rotation_required&&typeof license.metadata.base_reinstall_rotation_required==='object'?license.metadata.base_reinstall_rotation_required:null;
    if(rotationRequired)return NextResponse.json({ok:false,code:'LICENSE_ROTATION_REQUIRED'},{status:409});
    const client=await db().connect();
    try{
      await client.query('BEGIN');
      await client.query('select pg_advisory_xact_lock(hashtext($1))',[licenseId]);
      const reserved=(await client.query(`select installation_id from activations where license_id=$1 and installation_id<>$2 and status='active' order by last_seen_at desc limit 1`,[licenseId,installationId])).rows[0];
      if(reserved){await client.query('ROLLBACK');return NextResponse.json({ok:false,code:'INSTALLATION_LIMIT_REACHED'},{status:403});}
      const credential=generateInstallationCredential(),credentialHash=hashLicenseCredential(credential);
      const policy=license.metadata&&typeof license.metadata==='object'&&license.metadata.license_policy&&typeof license.metadata.license_policy==='object'?license.metadata.license_policy:{};
      const raw=policy.components&&typeof policy.components==='object'?policy.components:{};
      const components:any={orbitfs_base:{state:'active',allowed:true,lockedToThisInstallation:true,reason:null}};
      for(const id of ['orbitfs_mcp','orbitfs_apex','orbitfs_studio'])components[id]=raw[id]===true?{state:'locked',allowed:true,lockedToThisInstallation:true,reason:null}:{state:'blocked',allowed:false,lockedToThisInstallation:false,reason:'not_included'};
      const metadata={runtime_credential_hash:credentialHash,runtime_credential_type:'installation_scoped',runtime_credential_issued_at:new Date().toISOString(),registered_by:'deployer'};
      await client.query(`insert into activations(license_id,installation_id,product_version,status,metadata,current_components) values($1,$2,$3,'active',$4,$5) on conflict(license_id,installation_id) do update set status='active',last_seen_at=now(),product_version=coalesce(excluded.product_version,activations.product_version),metadata=coalesce(activations.metadata,'{}'::jsonb)||excluded.metadata,current_components=excluded.current_components`,[licenseId,installationId,body?.productVersion||body?.product_version||null,JSON.stringify(metadata),JSON.stringify(components)]);
      await client.query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values(null,$1,'installation.runtime_credential','license',$2,$3)`,[actor.actor||'deployer',licenseId,JSON.stringify({installation_id:installationId,credential_type:'installation_scoped'})]);
      await client.query('COMMIT');
      const runtime_policy={validation_ttl_seconds:Number(settings.validation_ttl_seconds||5400),offline_grace_seconds:Number(settings.offline_grace_seconds||0),pulse_poll_seconds:Number(settings.pulse_poll_seconds||5400),max_failed_validations:Number(settings.max_failed_validations||3),allow_offline_grace:Boolean(settings.allow_offline_grace),pulse_revision:Number(settings.pulse_revision||0),pulse_at:settings.pulse_at??null,pulse_reason:settings.pulse_reason??null,provider_outage_freeze_enabled:true,manual_authority_offline_uses_grace:true,freeze_grace_on_provider_failure:true,freeze_failure_counter_on_provider_failure:true};
      return NextResponse.json({ok:true,authority:'orbitfs-license-master-v2',licenseId,installationId,runtimeCredential:credential,keyHint:'••••'+credential.slice(-4),expiresAt:license.expires_at??null,runtimePolicy:runtime_policy,components});
    }catch(error){try{await client.query('ROLLBACK')}catch{}throw error}finally{client.release()}
  }
  if(phase==='sync')return NextResponse.json({ok:false,code:'CUSTOMER_DEPLOYER_EXECUTION_REQUIRED',error:'Provider status checks are executed by the customer deployer; License Manager does not accept customer provider credentials.'},{status:409});
  if(!releaseId)return NextResponse.json({ok:false,code:'RELEASE_ID_REQUIRED'},{status:400});
  if(!['deploy','base_update','update','redeploy','rollback'].includes(action))return NextResponse.json({ok:false,code:'UNSUPPORTED_DEPLOYMENT_ACTION'},{status:400});
  if(!['authorize','completed','failed'].includes(phase))return NextResponse.json({ok:false,code:'INVALID_DEPLOYMENT_PHASE'},{status:400});
  const settings=(await db().query('select system_enabled,licensing_enabled,maintenance_mode,release_system_enabled,deployment_enabled,base_deployment_enabled,update_deployment_enabled,rollback_enabled from system_settings where id=true')).rows[0];
  const authority={
    system_enabled:Boolean(settings?.system_enabled),
    licensing_enabled:Boolean(settings?.licensing_enabled),
    maintenance_mode:Boolean(settings?.maintenance_mode),
    release_system_enabled:Boolean(settings?.release_system_enabled),
    deployment_enabled:Boolean(settings?.deployment_enabled),
    base_deployment_enabled:settings?.base_deployment_enabled!==false,
    update_deployment_enabled:settings?.update_deployment_enabled!==false,
    rollback_enabled:settings?.rollback_enabled!==false,
  };
  if(!authority.system_enabled||!authority.licensing_enabled||authority.maintenance_mode)return NextResponse.json({ok:false,code:'AUTHORITY_UNAVAILABLE',authority},{status:503});
  if(!authority.release_system_enabled)return NextResponse.json({ok:false,code:'RELEASE_AUTHORITY_UNAVAILABLE',authority},{status:503});
  if(!authority.deployment_enabled)return NextResponse.json({ok:false,code:'DEPLOYMENT_AUTHORITY_UNAVAILABLE',authority},{status:503});
  if((action==='deploy'||action==='base_update'||action==='redeploy')&&!authority.base_deployment_enabled)return NextResponse.json({ok:false,code:'BASE_DEPLOYMENT_AUTHORITY_UNAVAILABLE',authority},{status:503});
  if(action==='update'&&!authority.update_deployment_enabled)return NextResponse.json({ok:false,code:'UPDATE_DEPLOYMENT_AUTHORITY_UNAVAILABLE',authority},{status:503});
  if(action==='rollback'&&!authority.rollback_enabled)return NextResponse.json({ok:false,code:'ROLLBACK_AUTHORITY_UNAVAILABLE',authority},{status:503});
  const release=(await db().query(`select r.*,p.slug product from releases r join products p on p.id=r.product_id where r.id=$1 limit 1`,[releaseId])).rows[0];
  if(!release)return NextResponse.json({ok:false,code:'RELEASE_NOT_FOUND'},{status:404});
  const expectedReleaseType=action==='update'||updateRollback?'update':'base';
  if(String(release.release_type)!==expectedReleaseType)return NextResponse.json({ok:false,code:'RELEASE_TYPE_ACTION_MISMATCH'},{status:409});
  const requestedChannel=String(body?.channel||body?.releaseChannel||body?.release_channel||'').trim().toLowerCase();
  if(requestedChannel&&requestedChannel!==String(release.channel||'').trim().toLowerCase())return NextResponse.json({ok:false,code:'RELEASE_CHANNEL_ACTION_MISMATCH'},{status:409});
  if(!release.checksum)return NextResponse.json({ok:false,code:'RELEASE_ARTIFACT_NOT_VERIFIED'},{status:409});
  const licenseId=String(body?.licenseId||body?.license_id||'').trim();
  if(!licenseId)return NextResponse.json({ok:false,code:'LICENSE_ID_REQUIRED',error:'No authoritative licence id was supplied for this installation.'},{status:403});
  const license=(await db().query(`select l.id,l.status,l.expires_at,l.metadata,l.customer_external_id,p.slug component from licenses l join products p on p.id=l.product_id where l.id=$1 and l.product_id=($2::uuid) limit 1`,[licenseId,release.product_id])).rows[0];
  if(!license)return NextResponse.json({ok:false,code:'LICENSE_NOT_ELIGIBLE_FOR_RELEASE',error:'The installation licence does not belong to this release product.'},{status:403});
  if(license.status!=='active')return NextResponse.json({ok:false,code:'LICENSE_NOT_ELIGIBLE_FOR_RELEASE',error:`The installation licence is ${license.status||'inactive'}; an active licence is required.`},{status:403});
  if(license.expires_at&&new Date(license.expires_at).getTime()<=Date.now())return NextResponse.json({ok:false,code:'LICENSE_NOT_ELIGIBLE_FOR_RELEASE',error:'The installation licence has expired.'},{status:403});

  let activation:any=null;
  let currentBase:any=null;
  if(installationId){
    activation=(await db().query("select id,status,product_version,last_deployment_id,last_deployment_url,coalesce((metadata->'deployment_lock'->>'locked')::boolean,false) deployment_locked,nullif(metadata->'deployment_lock'->>'reason','') deployment_lock_reason from activations where license_id=$1 and installation_id=$2 limit 1",[licenseId,installationId])).rows[0];
    const customerReference=String(license.customer_external_id||'').trim();
    currentBase=(await db().query(
      "select license_id,release_id,product_version,project_id,project_name,deployment_id,deployment_url,customer_identity,created_at from deployment_events where installation_id=$1 and phase='completed' and action in ('deploy','base_update','redeploy','rollback') and coalesce(details->>'rollbackScope','base')='base' and (license_id=$2 or ($3<>'' and lower(coalesce(customer_identity->>'customerNumber',''))=lower($3))) order by created_at desc limit 1",
      [installationId,licenseId,customerReference]
    )).rows[0]||null;
    // Runtime licence rotation must not erase an installation's deployment history.
    // A historical event from another licence is accepted only when its recorded
    // Billing customer number matches the current authoritative licence customer.
  }

  if(phase==='authorize'&&activation?.deployment_locked===true){
    return NextResponse.json({
      ok:false,
      code:'INSTALLATION_DEPLOYMENT_LOCKED',
      error:activation.deployment_lock_reason||'Deployment is locked for this installation by License Manager.',
      authority:'orbitfs-license-master-v2',
      installation:{installation_id:installationId,license_id:licenseId,deployment_locked:true,deployment_lock_reason:activation.deployment_lock_reason||null},
    },{status:423});
  }

  const publishedApproved=release.status==='published'&&release.review_status==='approved'&&!release.archived_at;
  if(updateRollback){
    if(release.review_status!=='approved')return NextResponse.json({ok:false,code:'UPDATE_ROLLBACK_NOT_AUTHORIZED'},{status:409});
  }else if(action==='redeploy'){
    // Redeploy means deploy the channel's currently published Base, not replay the installation's old release id.
    if(!publishedApproved)return NextResponse.json({ok:false,code:'RELEASE_NOT_DEPLOYABLE'},{status:409});
  }else if(action==='rollback'){
    if(release.review_status!=='approved'||!installationId)return NextResponse.json({ok:false,code:'BASE_ROLLBACK_NOT_AUTHORIZED'},{status:409});
    const prior=(await db().query(
      "select 1 from deployment_events where installation_id=$1 and release_id=$2 and phase='completed' and action in ('deploy','base_update','redeploy','rollback') and coalesce(details->>'rollbackScope','base')='base' and (license_id=$3 or ($4<>'' and lower(coalesce(customer_identity->>'customerNumber',''))=lower($4))) limit 1",
      [installationId,release.id,licenseId,String(license.customer_external_id||'').trim()]
    )).rows[0];
    if(!prior)return NextResponse.json({ok:false,code:'BASE_ROLLBACK_TARGET_NOT_INSTALLED'},{status:409});
  }else if(action==='base_update'){
    if(!publishedApproved)return NextResponse.json({ok:false,code:'RELEASE_NOT_DEPLOYABLE'},{status:409});
    if(!currentBase)return NextResponse.json({ok:false,code:'BASE_UPDATE_CURRENT_INSTALLATION_REQUIRED'},{status:409});
    const currentVersion=String(currentBase.product_version||body?.previousVersion||body?.previous_version||'').trim();
    const comparison=compareOrbitReleaseVersions(release.version,currentVersion);
    if(comparison===null)return NextResponse.json({ok:false,code:'BASE_VERSION_COMPARISON_FAILED'},{status:409});
    if(comparison===0)return NextResponse.json({ok:false,code:'BASE_UPDATE_ALREADY_CURRENT',message:'Use redeploy to redeploy the currently installed Base release.'},{status:409});
    if(comparison<0)return NextResponse.json({ok:false,code:'BASE_UPDATE_DOWNGRADE_FORBIDDEN',message:'Use the explicit Base rollback route for a previous installed release.'},{status:409});
    const previousVersion=String(body?.previousVersion||body?.previous_version||'').trim();
    if(previousVersion&&previousVersion!==currentVersion)return NextResponse.json({ok:false,code:'BASE_UPDATE_STALE_INSTALLATION'},{status:409});
    const projectId=String(body?.projectId||body?.project_id||'').trim();
    if(!projectId)return NextResponse.json({ok:false,code:'BASE_PROJECT_ID_REQUIRED'},{status:409});
    if(currentBase.project_id&&String(currentBase.project_id)!==projectId)return NextResponse.json({ok:false,code:'BASE_PROJECT_MISMATCH'},{status:409});
  }else if(action==='update'){
    if(!publishedApproved)return NextResponse.json({ok:false,code:'RELEASE_NOT_DEPLOYABLE'},{status:409});
    if(!installationId||!currentBase)return NextResponse.json({ok:false,code:'UPDATE_CURRENT_INSTALLATION_REQUIRED'},{status:409});
  }else if(!publishedApproved){
    return NextResponse.json({ok:false,code:'RELEASE_NOT_DEPLOYABLE'},{status:409});
  }
  const channel=String(release.channel||'stable');
  if(channel!=='stable'&&!updateRollback){
    const policy=(await db().query('select access_mode,enabled from release_channels where channel=$1 limit 1',[channel])).rows[0];
    if(!policy?.enabled)return NextResponse.json({ok:false,code:'RELEASE_CHANNEL_DISABLED'},{status:409});
    if(policy.access_mode==='closed'){
      const access=(await db().query('select 1 from release_channel_access where license_id=$1 and channel=$2 and (expires_at is null or expires_at>now()) limit 1',[licenseId,channel])).rows[0];
      if(!access)return NextResponse.json({ok:false,code:'LICENSE_CHANNEL_ACCESS_DENIED',error:`This licence is not assigned to the ${channel} release channel.`},{status:403});
    }
  }
  const releaseManifest=release.manifest&&typeof release.manifest==='object'?release.manifest:{};
  const updatePath=action==='update'||updateRollback;
  const allowedUpdateComponents=new Set(['base','apex','mcp','studio']);
  const rawReleaseComponents:string[]=[...new Set<string>((Array.isArray(releaseManifest.components)?releaseManifest.components:[])
    .map((value:any)=>String(value||'').trim().toLowerCase())
    .map((value:string)=>value==='orbitfs_mcp'?'mcp':value==='orbitfs_apex'?'apex':value==='orbitfs_studio'?'studio':value==='orbitfs_base'||value==='core'?'base':value)
    .filter(Boolean))];
  if(updatePath&&rawReleaseComponents.some((component:string)=>!allowedUpdateComponents.has(component))){
    return NextResponse.json({ok:false,code:'UPDATE_SCOPE_INVALID',error:'Update release contains an unsupported deployment component.'},{status:409});
  }
  const releaseComponents:string[]=updatePath
    ?rawReleaseComponents.filter((component:string)=>allowedUpdateComponents.has(component))
    :rawReleaseComponents.filter((component:string)=>component==='base');
  const policy=license.metadata&&typeof license.metadata==='object'&&license.metadata.license_policy&&typeof license.metadata.license_policy==='object'
    ?license.metadata.license_policy:{};
  const entitlementMap=policy.components&&typeof policy.components==='object'?policy.components:{};
  const licenseComponent=String(license.component||'').trim().toLowerCase();
  const entitledComponents:string[]=(updatePath?['base','apex','mcp','studio']:['base']).filter((component:string)=>{
    if(component==='base')return licenseComponent==='orbitfs_base'||Boolean(entitlementMap.orbitfs_base);
    return Boolean(entitlementMap['orbitfs_'+component]);
  });
  const executionComponents=updatePath
    ?releaseComponents.filter((component:string)=>entitledComponents.includes(component))
    :releaseComponents;
  const skippedComponents=updatePath
    ?releaseComponents.filter((component:string)=>!executionComponents.includes(component))
    :[];
  const componentPlan={releaseComponents,entitledComponents,executionComponents,skippedComponents};
  if(action==='update'&&phase==='authorize'&&releaseComponents.length&&!executionComponents.length){
    return NextResponse.json({ok:true,authorized:true,recorded:false,authority:'orbitfs-license-master-v2',notApplicable:true,code:'UPDATE_NOT_APPLICABLE',componentPlan,release:{id:release.id,version:release.version,releaseType:release.release_type,product:release.product,artifactSha256:release.checksum,sourceRepo:release.source_repo,sourceRef:release.source_ref},execution:'customer-deployer'});
  }

  const rawComponents=body?.componentState??body?.components;
  const componentState=Array.isArray(rawComponents)
    ?Object.fromEntries(rawComponents.map((value:any)=>[String(value),{version:String(release.version),status:phase==='completed'?'installed':phase}]))
    :(rawComponents&&typeof rawComponents==='object'?rawComponents:{});
  const installationProductVersion=action==='update'
    ?String(body?.baseVersion||body?.base_version||body?.previousVersion||body?.previous_version||'').trim()||null
    :(body?.productVersion?String(body.productVersion):release.version);
  const details={action,phase,rollbackScope:updateRollback?'update':'base',installationId:installationId||null,licenseId,releaseVersion:release.version,product:release.product,components:componentState,componentPlan,deploymentId:body?.deploymentId||body?.deployment_id||null,deploymentUrl:body?.deploymentUrl||body?.deployment_url||null,projectId:body?.projectId||body?.project_id||null,projectName:body?.projectName||body?.project_name||null,customerIdentity:body?.customerIdentity&&typeof body.customerIdentity==='object'?body.customerIdentity:null};
  await db().query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,$3,'release',$4,$5)`,[null,actor.actor||'deployer',`deployment.${phase}`,release.id,JSON.stringify(details)]);
  if(installationId){
    const completedComponents=phase==='completed'?componentState:{};
    await recordInstallationCheckIn({licenseId,installationId,action:action as any,phase:phase==='authorize'?'started':phase==='completed'?'completed':'failed',product:release.product,productVersion:installationProductVersion,previousVersion:body?.previousVersion?String(body.previousVersion):null,releaseId:release.id,deploymentId:details.deploymentId?String(details.deploymentId):null,deploymentUrl:details.deploymentUrl?String(details.deploymentUrl):null,projectId:details.projectId?String(details.projectId):null,projectName:details.projectName?String(details.projectName):null,provider:body?.provider?String(body.provider):'vercel',region:body?.region?String(body.region):null,platform:body?.platform?String(body.platform):'vercel',architecture:body?.architecture?String(body.architecture):null,hostname:body?.hostname?String(body.hostname):null,client:body?.client?String(body.client):'orbitfs-deployer',clientVersion:body?.clientVersion?String(body.clientVersion):null,sourceIp:requestIp(request),userAgent:request.headers.get('user-agent'),customerIdentity:details.customerIdentity,details:{components:completedComponents,requestedComponents:componentState,componentPlan,deploymentStatus:phase,releaseVersion:String(release.version),rollbackScope:updateRollback?'update':'base'}});
  }
  return NextResponse.json({ok:true,authorized:phase==='authorize',recorded:phase!=='authorize',authority:'orbitfs-license-master-v2',componentPlan,release:{id:release.id,version:release.version,releaseType:release.release_type,product:release.product,artifactSha256:release.checksum,sourceRepo:release.source_repo,sourceRef:release.source_ref},execution:phase==='authorize'?'customer-deployer':undefined});
}
