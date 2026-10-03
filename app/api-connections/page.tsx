import {revalidatePath} from 'next/cache';
import {requireUser} from '../../lib/session';
import {listOfficialApiConnections,saveOfficialApiConnection} from '../../lib/core/api-connections';
import SideNav from '../components/SideNav';
import PageHeader from '../components/PageHeader';

export const dynamic='force-dynamic';

const clientMap={
 license_manager:['billing_store','dev_panel','release_builder'],
 license_runtime:['v1_base','v1_engine','billing_store'],
} as const;

async function saveConnection(formData:FormData){
 'use server';
 const user=await requireUser();
 if(!['owner','admin'].includes(user.role))return;
 const service=String(formData.get('service_key')||'license_manager') as keyof typeof clientMap;
 const timeout=Math.min(120000,Math.max(1000,Number(formData.get('timeout_ms')||8000)));
 const cache=Math.min(3600,Math.max(0,Number(formData.get('cache_seconds')||0)));
 await saveOfficialApiConnection({
  id:String(formData.get('id')||'').trim()||null,
  service_key:service,
  label:String(formData.get('label')||'').trim(),
  base_url:String(formData.get('base_url')||'').trim(),
  allowed_clients:[...(clientMap[service]||[])],
  enabled:formData.get('enabled')==='on',
  priority:Number(formData.get('priority')||100),
  settings:{
   timeout_ms:timeout,
   cache_seconds:cache,
   health_path:String(formData.get('health_path')||'').trim()||null,
   auth_mode:String(formData.get('auth_mode')||'').trim()||null,
  },
 },user.id,user.email);
 revalidatePath('/api-connections');
}

export default async function ApiConnections(){
 const user=await requireUser();
 const canManage=['owner','admin'].includes(user.role);
 const rows=await listOfficialApiConnections({includeDisabled:true});
 const active=rows.filter((row:any)=>row.enabled).length;

 return <div className="shell"><SideNav active="api-connections"/><main className="main">
  <PageHeader eyebrow="System / Official integrations" title="API Connections" description="License Manager is the trust authority for official OrbitFS API endpoints. Only one endpoint per service can be active at a time; enabling a replacement disables the previous endpoint." badge={active?active+' ACTIVE':'REGISTRY EMPTY'}/>

  <div className="grid dashboard-metrics api-metrics">
   <div className="card metric-card"><div className="metric-icon icon-blue">⌁</div><div><span className="metric-label">Official endpoints</span><strong className="metric">{rows.length}</strong><small>{active} enabled</small></div></div>
   <div className="card metric-card"><div className="metric-icon icon-green">✓</div><div><span className="metric-label">Trust rule</span><strong className="metric api-mode-metric">Exact match</strong><small>Random URLs are rejected</small></div></div>
   <div className="card metric-card"><div className="metric-icon icon-indigo">LM</div><div><span className="metric-label">Registry authority</span><strong className="metric api-mode-metric">License Manager</strong><small>/api/v1/api-connections</small></div></div>
  </div>

  <section className="section">
   <div className="section-head"><div><div className="eyebrow">Official registry</div><h2>OrbitFS API endpoints</h2><p className="muted">Billing Store and Dev Panel use the License Manager control API. Base and Engine runtimes use the public licence runtime API. Installation-specific Panel, Engine Host, Vercel and customer Supabase URLs do not belong in this registry.</p></div></div>
   <div className="grid">
    {rows.map((row:any)=>{
     const settings=row.settings&&typeof row.settings==='object'?row.settings:{};
     return <form action={saveConnection} className="card section" key={row.id}>
      <input type="hidden" name="id" value={row.id}/><input type="hidden" name="service_key" value={row.service_key}/><input type="hidden" name="auth_mode" value={settings.auth_mode||''}/>
      <div className="section-head"><div><div className="eyebrow">{String(row.service_key).replaceAll('_',' ')}</div><h2>{row.label}</h2><p className="muted">{row.allowed_clients?.join(' · ')||'No clients assigned'}</p></div><span className={row.enabled?'badge':'header-badge'}>{row.enabled?'ENABLED':'DISABLED'}</span></div>
      <div className="policy-grid">
       <label><span>Label</span><input className="input" name="label" defaultValue={row.label} readOnly={!canManage}/></label>
       <label style={{gridColumn:'1 / -1'}}><span>Official API URL</span><input className="input mono" name="base_url" defaultValue={row.base_url} readOnly={!canManage}/><small className="muted">Must be HTTPS on an OrbitFS-controlled incendiarynetworks.cc host and use the exact service path.</small></label>
       <label><span>Priority</span><input className="input" name="priority" type="number" min="0" max="10000" defaultValue={Number(row.priority||100)} readOnly={!canManage}/></label>
       <label><span>Timeout</span><div className="number-input"><input className="input" name="timeout_ms" type="number" min="1000" max="120000" defaultValue={Number(settings.timeout_ms||8000)} readOnly={!canManage}/><b>ms</b></div></label>
       <label><span>Cache</span><div className="number-input"><input className="input" name="cache_seconds" type="number" min="0" max="3600" defaultValue={Number(settings.cache_seconds||0)} readOnly={!canManage}/><b>sec</b></div></label>
       <label><span>Health path</span><input className="input mono" name="health_path" defaultValue={String(settings.health_path||'')} readOnly={!canManage}/></label>
       {canManage&&<label className="toggle-line"><input type="checkbox" name="enabled" defaultChecked={Boolean(row.enabled)}/><span><b>Endpoint enabled</b><small>Enabling this endpoint automatically disables every other endpoint for the same service.</small></span></label>}
       {canManage&&<div className="policy-submit"><button className="button">Save official endpoint</button></div>}
      </div>
     </form>;
    })}
    {!rows.length&&<div className="card"><strong>Official API registry is not available yet.</strong><p className="muted">Apply the 20260929 official API connections migration, then this page will show the seeded License Manager and runtime endpoints.</p></div>}
   </div>
  </section>

  {canManage&&<details className="section card collapsible-card">
   <summary className="collapsible-summary"><div><div className="eyebrow">Additional official endpoint</div><h2>Add fallback / replacement API</h2><p className="muted">Use this only for an OrbitFS-controlled incendiarynetworks.cc API. Downstream clients still select only enabled exact registry entries.</p></div><span className="collapse-chevron">⌄</span></summary>
   <div className="collapsible-body"><form action={saveConnection} className="policy-grid">
    <label><span>Service</span><select className="input" name="service_key" defaultValue="license_manager"><option value="license_manager">License Manager control API</option><option value="license_runtime">Licence runtime API</option></select></label>
    <label><span>Label</span><input className="input" name="label" placeholder="Secondary OrbitFS API" required/></label>
    <label style={{gridColumn:'1 / -1'}}><span>Official API URL</span><input className="input mono" name="base_url" placeholder="https://api.incendiarynetworks.cc/api/v1" required/></label>
    <label><span>Priority</span><input className="input" name="priority" type="number" min="0" max="10000" defaultValue="100"/></label>
    <label><span>Timeout</span><div className="number-input"><input className="input" name="timeout_ms" type="number" min="1000" max="120000" defaultValue="10000"/><b>ms</b></div></label>
    <label><span>Cache</span><div className="number-input"><input className="input" name="cache_seconds" type="number" min="0" max="3600" defaultValue="0"/><b>sec</b></div></label>
    <label><span>Health path</span><input className="input mono" name="health_path" defaultValue="/health"/></label>
    <label className="toggle-line"><input type="checkbox" name="enabled" defaultChecked/><span><b>Endpoint enabled</b><small>Activating this replacement automatically takes the previous endpoint offline for this service.</small></span></label>
    <div className="policy-submit"><button className="button">Add official endpoint</button></div>
   </form></div>
  </details>}
 </main></div>;
}
