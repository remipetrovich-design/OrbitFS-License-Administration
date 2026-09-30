import {db} from '../../lib/db';
import {requireUser} from '../../lib/session';
import {setInstallationStatus} from '../../lib/core/licenses';
import SideNav from '../components/SideNav';
import PageHeader from '../components/PageHeader';
import TableTools from '../components/TableTools';
export const dynamic='force-dynamic';
const roles=['owner','admin','operator'];
async function control(formData:FormData){'use server';const user=await requireUser();if(!roles.includes(user.role))return;const id=String(formData.get('id')||'');const status=String(formData.get('status')||'') as 'active'|'released';if(id&&['active','released'].includes(status))await setInstallationStatus(id,status,user.id,user.email);}
export default async function Installations({searchParams}:{searchParams:Promise<{license?:string}>}){
 const user=await requireUser();
 const params=await searchParams;
 const license=String(params?.license||'').trim();
 const query=`select a.id,a.installation_id,a.product_version,a.status,a.first_seen_at,a.last_seen_at,a.last_ip,a.last_user_agent,a.last_hostname,a.last_platform,a.last_architecture,a.last_client,a.last_client_version,a.last_provider,a.last_region,a.last_deployment_id,a.last_deployment_url,a.last_deployment_status,a.last_operation,a.deployment_count,a.current_components,a.metadata,l.id license_id,l.license_key_last4,l.status license_status,l.customer_external_id,p.slug product,p.name product_name from activations a join licenses l on l.id=a.license_id join products p on p.id=l.product_id ${license?'where l.id=$1':''} order by a.last_seen_at desc limit 500`;
 const rows=(await db().query(query,license?[license]:[])).rows;
 const statuses=[...new Set(rows.map((x:any)=>x.status))];
 const active=rows.filter((x:any)=>x.status==='active').length;
 const released=rows.filter((x:any)=>x.status==='released').length;
 const deployments=rows.reduce((sum:number,x:any)=>sum+Number(x.deployment_count||0),0);

 return <div className="shell"><SideNav active="installations"/><main className="main">
  <PageHeader eyebrow="Authority / Installations" title="Deployment Installations" description="Live installation bindings, runtime identity and deployment telemetry connected to authoritative licences." badge={String(rows.length)}/>

  <div className="grid release-stats">
   <div className="card stat-card"><div className="stat-label">Active installations</div><div className="metric">{active}</div><small className="muted">Allowed to continue under current licence state</small></div>
   <div className="card stat-card"><div className="stat-label">Released</div><div className="metric">{released}</div><small className="muted">Historical installations; licence is unbound</small></div>
   <div className="card stat-card"><div className="stat-label">Deployment events</div><div className="metric">{deployments}</div><small className="muted">Recorded across listed installations</small></div>
  </div>

  {license&&<div className="notice installation-filter">Showing installations for one licence. <a href="/installations">Clear licence filter</a></div>}

  <section className="section card">
   <div className="section-head"><div><div className="eyebrow">Runtime bindings</div><h2>Installation registry</h2><p className="muted">Each record combines licence authority, installation identity, runtime metadata and the latest reported deployment state.</p></div><span className="badge">{rows.length} records</span></div>
   <TableTools targetId="installation-table" filters={statuses}/>
   <div className="table-shell" id="installation-table"><table className="table"><thead><tr><th>Product / customer</th><th>Installation</th><th>Version</th><th>Status</th><th>Last seen</th><th>Runtime</th><th>Deployment</th><th>Controls</th></tr></thead><tbody>{rows.map((x:any)=><tr key={x.id} data-row data-filter={x.status} data-search={[x.product_name||x.product,x.customer_external_id||'',x.installation_id,x.product_version||'',x.status,x.last_provider||'',x.last_region||''].join(' ')}><td><strong>{x.product_name||x.product}</strong><small className="muted" style={{display:'block'}}>{x.customer_external_id||'No customer'} · ••••-{x.license_key_last4}</small></td><td><strong className="mono">{x.installation_id}</strong><small className="muted" style={{display:'block'}}>{x.last_hostname||'No hostname'}</small></td><td>{x.product_version||'—'}</td><td><span className={x.status==='active'?'state-pill online':'state-pill offline'}>{x.status}</span></td><td>{x.last_seen_at?new Date(x.last_seen_at).toLocaleString():'—'}</td><td><div>{[x.last_platform,x.last_architecture].filter(Boolean).join(' · ')||'Unknown runtime'}</div><small className="muted">{[x.last_client,x.last_client_version,x.last_provider,x.last_region].filter(Boolean).join(' · ')||x.last_ip||'No runtime metadata'}</small></td><td><div>{x.last_operation||'No operation'} {x.last_deployment_status?'· '+x.last_deployment_status:''}</div><small className="muted">{x.last_deployment_id||'No deployment recorded'}</small></td><td>{roles.includes(user.role)&&x.status==='active'&&<div className="actions"><form action={control}><input type="hidden" name="id" value={x.id}/><input type="hidden" name="status" value="released"/><button className="button secondary">Unlock / release</button></form></div>}</td></tr>)}</tbody></table></div>
  </section>
 </main></div>;
}