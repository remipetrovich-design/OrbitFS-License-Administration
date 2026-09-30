import Link from 'next/link';
import {listReleases} from '../../lib/core/releases';
import SideNav from '../components/SideNav';
import PageHeader from '../components/PageHeader';
import TableTools from '../components/TableTools';
import ReleaseQueueActions from '../components/ReleaseQueueActions';
export const dynamic='force-dynamic';
function validation(r:any){const v=r.manifest?.validation||{};return {status:v.status||'not run',checks:Array.isArray(v.checks)?v.checks:[]};}
export default async function Releases(){
 const releases=(await listReleases(true)).filter((r:any)=>r.release_type==='update');
 const active=releases.filter((r:any)=>!r.archived_at);
 const pending=active.filter((r:any)=>r.review_status==='pending').length;
 const ready=active.filter((r:any)=>r.review_status==='approved'&&r.status!=='published').length;
 const published=active.filter((r:any)=>r.status==='published').length;
 const blocked=active.filter((r:any)=>validation(r).status==='failed'||r.review_status==='rejected').length;
 const componentCount=new Set(active.flatMap((r:any)=>Array.isArray(r.manifest?.components)?r.manifest.components:[])).size;
 return <div className="shell"><SideNav active="releases"/><main className="main">
  <PageHeader eyebrow="Release Authority / Engine" title="Release Updates" description="Technical intake, validation and approval for manifest-driven Engine updates. Billing Store performs the final customer-facing review and publication step." badge="ENGINE"/>

  <section className="release-hero card">
   <div className="release-hero-copy"><div className="eyebrow">Update authority flow</div><h2>Validate the package before customer publication</h2><p className="muted">GitHub builds the update package and manifest, License Manager validates and approves it, then Billing Store performs the final publication review. Customer deployers execute only the manifest-approved targets.</p></div>
   <div className="release-hero-flow"><span className="flow-step active"><b>1</b> Intake</span><span className="flow-arrow">→</span><span className="flow-step"><b>2</b> Validate</span><span className="flow-arrow">→</span><span className="flow-step"><b>3</b> Technical approve</span><span className="flow-arrow">→</span><span className="flow-step"><b>4</b> Billing review</span></div>
  </section>

  <div className="grid release-stats">
   <div className="card stat-card"><div className="stat-label">Needs technical review</div><div className="metric">{pending}</div><small className="muted">Awaiting License Manager decision</small></div>
   <div className="card stat-card"><div className="stat-label">Blocked</div><div className="metric">{blocked}</div><small className="muted">Failed validation or rejected</small></div>
   <div className="card stat-card"><div className="stat-label">Approved</div><div className="metric">{ready}</div><small className="muted">Ready for Billing Store final review</small></div>
   <div className="card stat-card"><div className="stat-label">Published</div><div className="metric">{published}</div><small className="muted">{componentCount} active component targets seen</small></div>
  </div>

  <section className="section card">
   <div className="section-head"><div><div className="eyebrow">Authoritative queue</div><h2>Engine update candidates</h2><p className="muted">Every row is a real release record submitted by the Engine release builder. Open a candidate for its complete manifest, validation checks, artifact identity and audit history.</p></div><div className="queue-header-actions"><span className="badge">{active.length} active</span><Link className="button secondary" href="/releases/base">Base releases</Link></div></div>
   <TableTools targetId="update-release-list" filters={['pending','approved','rejected','published']} pageSize={3}/>
   <div id="update-release-list" className="release-list">
    {releases.length===0?<div className="empty-state"><strong>No update candidates</strong><span>Nothing has arrived from the Engine release workflow yet.</span></div>:releases.map((r:any)=>{
      const v=validation(r),archived=Boolean(r.archived_at),failed=v.status==='failed'||r.review_status==='rejected';
      const state=archived?'archived':r.status==='published'?'published':failed?'blocked':r.review_status==='approved'?'approved':v.status==='passed'?'validated':'needs validation';
      const components=Array.isArray(r.manifest?.components)?r.manifest.components:[];
      const passed=v.checks.filter((x:any)=>x.ok).length;
      return <article className={archived?"release-item release-item-archived":"release-item"} data-row data-filter={r.review_status} data-search={[r.product_name||r.product,r.version,r.channel,r.status,r.review_status,components.join(' '),r.source_repo||'',r.source_sha||''].join(' ')} key={r.id}>
       <div className="release-item-top">
        <div className="release-primary"><div className="eyebrow">{r.product_name||r.product||'OrbitFS Engine'} · {r.channel}</div><Link href={'/releases/'+r.id} className="release-title-link"><h3>{r.version}</h3></Link><div className="tag-row"><span className={state==='approved'||state==='published'?'badge ok':state==='blocked'?'badge off':'badge'}>{state}</span><span className={r.review_status==='approved'?'badge ok':r.review_status==='rejected'?'badge off':'badge'}>review {r.review_status}</span><span className={v.status==='passed'?'badge ok':v.status==='failed'?'badge off':'badge'}>validation {v.status}</span>{archived&&<span className="badge off">archived</span>}</div></div>
        <ReleaseQueueActions id={r.id} reviewStatus={r.review_status} validationStatus={v.status} published={r.status==='published'} archived={archived} releaseType="update"/>
       </div>
       <div className="release-meta release-meta-base">
        <div><small className="muted">Manifest targets</small><strong>{components.length||0} components</strong><span>{components.join(', ')||'No components recorded'}</span></div>
        <div><small className="muted">Source</small><strong>{r.source_repo||'—'}</strong><span>{r.source_ref||'—'}</span></div>
        <div><small className="muted">Source commit</small><strong className="mono">{r.source_sha||'—'}</strong></div>
        <div><small className="muted">Validation</small><strong>{passed}/{v.checks.length||0} checks</strong><span>{v.status==='passed'?'Technically valid':v.status==='failed'?'Fix required':'Not completed'}</span></div>
       </div>
       {failed&&<div className="release-blocker"><strong>Technical blocker</strong><span>{v.checks.find((x:any)=>!x.ok)?.message||r.review_reason||'Candidate requires attention before it can continue.'}</span><Link href={'/releases/'+r.id}>Open review →</Link></div>}
      </article>;
    })}
   </div>
  </section>
 </main></div>
}