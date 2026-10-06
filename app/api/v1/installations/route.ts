import {NextResponse} from 'next/server';
import {integrationAuthorized} from '../../../../lib/auth';
import {db} from '../../../../lib/db';

function lockState(metadata:any){
  const value=metadata&&typeof metadata==='object'&&metadata.deployment_lock&&typeof metadata.deployment_lock==='object'?metadata.deployment_lock:{};
  return {
    deployment_locked:value.locked===true,
    deployment_lock_reason:value.locked===true?String(value.reason||'').trim()||null:null,
    deployment_lock_changed_at:String(value.changed_at||'').trim()||null,
    deployment_lock_changed_by:String(value.changed_by||'').trim()||null,
  };
}

export async function GET(request:Request){
  const actor=await integrationAuthorized(request,'deployment.read');
  if(!actor)return NextResponse.json({ok:false,code:'UNAUTHORIZED'},{status:401});
  const u=new URL(request.url);
  const requested=Number(u.searchParams.get('limit')||250);
  const limit=Math.min(500,Math.max(1,Number.isFinite(requested)?requested:250));
  const currentOnly=['1','true','yes'].includes(String(u.searchParams.get('current_only')||'').toLowerCase());
  const rows=(await db().query(
    `select
       a.id,a.license_id,a.installation_id,a.status,a.product_version,a.first_seen_at,a.last_seen_at,
       a.last_ip,a.last_user_agent,a.last_hostname,a.last_platform,a.last_architecture,a.last_client,a.last_client_version,
       a.last_provider,a.last_region,a.last_deployment_id,a.last_deployment_url,a.last_deployment_status,a.last_operation,
       a.deployment_count,a.current_components,a.metadata,
       l.status license_status,l.expires_at license_expires_at,l.customer_external_id,
       p.slug product,
       base.release_id base_release_id,base.product_version base_product_version,base.deployment_id base_deployment_id,
       base.deployment_url base_deployment_url,base.project_id base_project_id,base.project_name base_project_name,
       base.created_at base_completed_at,base.release_version base_release_version,base.release_channel base_release_channel,
       upd.action update_action,upd.release_id update_release_id,upd.product_version update_product_version,upd.deployment_id update_deployment_id,
       upd.deployment_url update_deployment_url,upd.created_at update_completed_at,
       upd.release_version update_release_version,upd.release_channel update_release_channel
     from activations a
     join licenses l on l.id=a.license_id
     join products p on p.id=l.product_id
     left join lateral (
       select e.release_id,e.product_version,e.deployment_id,e.deployment_url,e.project_id,e.project_name,e.created_at,
              r.version release_version,r.channel release_channel
       from deployment_events e
       left join releases r on r.id=e.release_id
       where e.installation_id=a.installation_id and e.license_id=a.license_id and e.phase='completed'
         and e.action in ('deploy','base_update','redeploy','rollback')
         and coalesce(e.details->>'rollbackScope','base')='base'
       order by e.created_at desc
       limit 1
     ) base on true
     left join lateral (
       select e.action,e.release_id,e.product_version,e.deployment_id,e.deployment_url,e.created_at,
              r.version release_version,r.channel release_channel
       from deployment_events e
       left join releases r on r.id=e.release_id
       where e.installation_id=a.installation_id and e.license_id=a.license_id and e.phase='completed'
         and (e.action='update' or (e.action='rollback' and coalesce(e.details->>'rollbackScope','base')='update'))
       order by e.created_at desc
       limit 1
     ) upd on true
     where ($2::boolean=false or a.status='active')
     order by a.last_seen_at desc nulls last,a.first_seen_at desc
     limit $1`,
    [limit,currentOnly],
  )).rows;

  const installations=rows.map((row:any)=>{
    const lock=lockState(row.metadata);
    return {
      id:row.id,
      license_id:row.license_id,
      installation_id:row.installation_id,
      status:row.status,
      product:row.product,
      product_version:row.product_version,
      license_status:row.license_status,
      license_expires_at:row.license_expires_at,
      customer_external_id:row.customer_external_id,
      first_seen_at:row.first_seen_at,
      last_seen_at:row.last_seen_at,
      last_ip:row.last_ip,
      last_user_agent:row.last_user_agent,
      last_hostname:row.last_hostname,
      last_platform:row.last_platform,
      last_architecture:row.last_architecture,
      last_client:row.last_client,
      last_client_version:row.last_client_version,
      last_provider:row.last_provider,
      last_region:row.last_region,
      last_deployment_id:row.last_deployment_id,
      last_deployment_url:row.last_deployment_url,
      last_deployment_status:row.last_deployment_status,
      last_operation:row.last_operation,
      deployment_count:row.deployment_count,
      current_components:row.current_components,
      panel_domain:row.metadata&&typeof row.metadata==='object'&&row.metadata.panel_domain&&typeof row.metadata.panel_domain==='object'?row.metadata.panel_domain:null,
      ...lock,
      current_base:row.base_release_id?{
        release_id:row.base_release_id,
        product_version:row.base_product_version,
        release_version:row.base_release_version,
        release_channel:row.base_release_channel,
        deployment_id:row.base_deployment_id,
        deployment_url:row.base_deployment_url,
        project_id:row.base_project_id,
        project_name:row.base_project_name,
        completed_at:row.base_completed_at,
      }:null,
      current_update:row.update_action==='update'&&row.update_release_id?{
        release_id:row.update_release_id,
        product_version:row.update_product_version,
        release_version:row.update_release_version,
        release_channel:row.update_release_channel,
        deployment_id:row.update_deployment_id,
        deployment_url:row.update_deployment_url,
        completed_at:row.update_completed_at,
      }:null,
    };
  });

  return NextResponse.json({ok:true,authority:'orbitfs-license-master-v2',installations},{headers:{'cache-control':'no-store'}});
}
