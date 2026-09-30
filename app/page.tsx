import Link from 'next/link';
import {db} from '../lib/db';
import {requireUser} from '../lib/session';
import SideNav from './components/SideNav';
import PageHeader from './components/PageHeader';

export const dynamic='force-dynamic';

async function stats(){
 const p=db();
 const [licenses,products,published,pending,failed,activations,settings,activity,recent]=await Promise.all([
  p.query("select count(*)::int count from licenses"),
  p.query("select count(*)::int count from products where status <> 'archived'"),
  p.query("select count(*)::int count from releases where status='published'"),
  p.query("select count(*)::int count from releases where status <> 'published' and review_status='pending' and archived_at is null"),
  p.query("select count(*)::int count from releases where coalesce((manifest->'validation'->>'status'),'not_run')='failed' and archived_at is null"),
  p.query("select count(*)::int count from activations where status='active'"),
  p.query("select system_enabled,licensing_enabled,release_system_enabled,deployment_enabled,maintenance_mode,pulse_revision,pulse_at from system_settings where id=true"),
  p.query("select date_trunc('day',created_at)::date as activity_day,count(*)::int as count from audit_events where created_at >= now()-interval '6 days' group by 1 order by 1"),
  p.query("select action,actor,resource_type,created_at from audit_events order by created_at desc limit 7")
 ]);
 return {
  licenses:licenses.rows[0].count,products:products.rows[0].count,published:published.rows[0].count,
  pending:pending.rows[0].count,failed:failed.rows[0].count,activations:activations.rows[0].count,
  settings:settings.rows[0],activity:activity.rows,recent:recent.rows
 };
}

export default async function Home(){
 await requireUser();
 const s=await stats();
 const online=Boolean(s.settings?.system_enabled);
 const maintenance=Boolean(s.settings?.maintenance_mode);
 const apiStates=[
  ['External API',online,online?'Online':'Offline','Master authority'],
  ['Licensing API',online&&Boolean(s.settings?.licensing_enabled)&&!maintenance,maintenance?'Maintenance':Boolean(s.settings?.licensing_enabled)?'Online':'Offline','Validation & issuance'],
  ['Release API',online&&Boolean(s.settings?.release_system_enabled),Boolean(s.settings?.release_system_enabled)?'Online':'Offline','Release intake & state'],
  ['Deployment API',online&&Boolean(s.settings?.deployment_enabled),Boolean(s.settings?.deployment_enabled)?'Online':'Offline','Authorization']
 ] as const;
 const dayMap=new Map(s.activity.map((x:any)=>[String(x.activity_day).slice(0,10),Number(x.count)]));
 const days=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));const key=d.toISOString().slice(0,10);return {key,label:d.toLocaleDateString(undefined,{weekday:'short'}),count:dayMap.get(key)||0};});
 const max=Math.max(1,...days.map(x=>x.count));

 return <div className="shell"><SideNav active="overview"/><main className="main dashboard-main">
  <PageHeader eyebrow="Authority Control Plane" title="License Manager" description="Quick operational view of licensing, release and deployment authority." badge={online?'LIVE':'OFFLINE'}/>

  <section className={online?'dashboard-health healthy':'dashboard-health offline'}>
   <div><span className={online?'status-light online':'status-light offline'}/><div><strong>{online?'Authority online':'Authority offline'}</strong><small>{maintenance?'Maintenance mode is active.':'Current external API posture.'}</small></div></div>
   <Link href="/settings" className="button secondary">API control</Link>
  </section>

  <section className="dashboard-api-strip" aria-label="API status">
   {apiStates.map(([name,healthy,label,detail])=><div className="dashboard-api-status" key={name}>
    <span className={label==='Maintenance'?'status-light warning':healthy?'status-light online':'status-light offline'}/>
    <div><strong>{name}</strong><small>{detail}</small></div>
    <span className={label==='Maintenance'?'state-pill warning':healthy?'state-pill online':'state-pill offline'}>{label}</span>
   </div>)}
  </section>

  <div className="grid dashboard-metrics dashboard-metrics-compact">
   <Link href="/licenses" className="card metric-card link-card"><div className="metric-icon icon-indigo">◇</div><div><span className="metric-label">Licences</span><strong className="metric">{s.licenses}</strong><small>{s.activations} active installs</small></div></Link>
   <Link href="/releases" className="card metric-card link-card"><div className="metric-icon icon-blue">↻</div><div><span className="metric-label">Pending releases</span><strong className="metric">{s.pending}</strong><small>{s.published} published</small></div></Link>
   <Link href="/releases" className="card metric-card link-card"><div className="metric-icon icon-red">!</div><div><span className="metric-label">Blockers</span><strong className="metric">{s.failed}</strong><small>{s.failed===0?'Clear':'Needs review'}</small></div></Link>
   <Link href="/products" className="card metric-card link-card"><div className="metric-icon icon-green">◈</div><div><span className="metric-label">Products</span><strong className="metric">{s.products}</strong><small>Authority definitions</small></div></Link>
  </div>

  <div className="dashboard-collapsible-grid section">
   <details className="card dashboard-panel">
    <summary><div><div className="eyebrow">Analytics</div><strong>Authority activity</strong><small>7-day audited activity</small></div><span className="dashboard-chevron">⌄</span></summary>
    <div className="dashboard-panel-body">
     <div className="bar-chart" aria-label="Authority activity over seven days">{days.map(day=><div className="bar-column" key={day.key}><div className="bar-value">{day.count}</div><div className="bar-track"><div className="bar-fill" style={{height:Math.max(6,Math.round((day.count/max)*100))+'%'}}/></div><span>{day.label}</span></div>)}</div>
    </div>
   </details>

   <details className="card dashboard-panel">
    <summary><div><div className="eyebrow">Operations</div><strong>Quick actions</strong><small>Jump into authority workflows</small></div><span className="dashboard-chevron">⌄</span></summary>
    <div className="dashboard-panel-body">
     <div className="quick-control-grid">
      <Link href="/releases/base" className="quick-control"><span className="quick-icon">↳</span><div><strong>Base Deployment</strong><small>Validate and publish Base releases</small></div><b>→</b></Link>
      <Link href="/releases" className="quick-control"><span className="quick-icon">↻</span><div><strong>Release Updates</strong><small>Review Engine candidates</small></div><b>→</b></Link>
      <Link href="/licenses" className="quick-control"><span className="quick-icon">◇</span><div><strong>Licensing</strong><small>Issue and control licences</small></div><b>→</b></Link>
      <Link href="/installations" className="quick-control"><span className="quick-icon">▣</span><div><strong>Installations</strong><small>Inspect runtime state</small></div><b>→</b></Link>
     </div>
    </div>
   </details>

   <details className="card dashboard-panel">
    <summary><div><div className="eyebrow">Audit</div><strong>Recent activity</strong><small>{s.recent.length} latest authority events</small></div><span className="dashboard-chevron">⌄</span></summary>
    <div className="dashboard-panel-body">
     <div className="activity-list">{s.recent.length===0?<div className="empty-state"><strong>No audit activity</strong><span>Authority actions will appear here.</span></div>:s.recent.map((item:any,index:number)=><div className="activity-row" key={index}><span className="activity-dot"/><div><strong>{String(item.action).replaceAll('.',' ')}</strong><small>{item.actor||'system'} · {item.resource_type}</small></div><time>{new Date(item.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time></div>)}</div>
    </div>
   </details>

   <details className="card dashboard-panel">
    <summary><div><div className="eyebrow">Runtime</div><strong>Pulse status</strong><small>Authority cache recheck state</small></div><span className="dashboard-chevron">⌄</span></summary>
    <div className="dashboard-panel-body">
     <div className="pulse-strip"><span>Pulse revision</span><strong>#{Number(s.settings?.pulse_revision||0)}</strong><small>{s.settings?.pulse_at?new Date(s.settings.pulse_at).toLocaleString():'No pulse yet'}</small></div>
    </div>
   </details>
  </div>
 </main></div>;
}
