import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { requireUser } from '../../../lib/session';
import { listReleases, setReleaseReview, validateRelease } from '../../../lib/core/releases';
import SideNav from '../../components/SideNav';
import PageHeader from '../../components/PageHeader';
import TableTools from '../../components/TableTools';
import ReleaseQueueActions from '../../components/ReleaseQueueActions';

export const dynamic = 'force-dynamic';
const roles = ['owner', 'admin', 'operator'];

async function validate(formData: FormData) {
  'use server';
  const u = await requireUser();
  if (!roles.includes(u.role)) return;
  const id = String(formData.get('id') || '');
  if (id) {
    await validateRelease(id, u.id, u.email);
    revalidatePath('/releases/base');
    revalidatePath('/releases/' + id);
  }
}

async function review(formData: FormData) {
  'use server';
  const u = await requireUser();
  if (!roles.includes(u.role)) return;
  const id = String(formData.get('id') || '');
  const decision = String(formData.get('decision') || '');
  if (id && (decision === 'approved' || decision === 'rejected')) {
    await setReleaseReview(id, decision, u.id, u.email, String(formData.get('reason') || '').trim() || undefined);
    revalidatePath('/releases/base');
    revalidatePath('/releases/' + id);
  }
}

function validation(r: any) {
  const v = r.manifest?.validation || {};
  return { status: v.status || 'not run', checks: Array.isArray(v.checks) ? v.checks : [] };
}

export default async function BaseDeployment() {
  const releases = (await listReleases(true)).filter((r: any) => r.release_type === 'base');
  const pending = releases.filter((r: any) => r.review_status === 'pending' && !r.archived_at).length;
  const ready = releases.filter((r: any) => r.review_status === 'approved' && r.status !== 'published' && !r.archived_at).length;
  const published = releases.filter((r: any) => r.status === 'published').length;
  const blocked = releases.filter((r: any) => validation(r).status === 'failed' || r.review_status === 'rejected').length;

  return <div className="shell">
    <SideNav active="base" />
    <main className="main">
      <PageHeader
        eyebrow="Release Authority / Base"
        title="Base Release Control"
        description="The License Manager is the technical authority for OrbitFS Base. Candidates arrive from the release worker, are validated here, then receive Base review, approval and publication from the License Manager."
        badge="ORBITFS_BASE"
      />

      <section className="release-hero card">
        <div className="release-hero-copy">
          <div className="eyebrow">Current gate</div>
          <h2>Technical validation → approval → publish</h2>
          <p className="muted">This page does not deploy customer infrastructure. It proves that a Base package is valid, records the technical decision, and publishes approved Base releases for the customer portal/deployer.</p>
        </div>
        <div className="release-hero-flow">
          <span className="flow-step active"><b>1</b> Intake</span><span className="flow-arrow">→</span>
          <span className="flow-step"><b>2</b> Validate</span><span className="flow-arrow">→</span>
          <span className="flow-step"><b>3</b> Approve</span><span className="flow-arrow">→</span>
          <span className="flow-step"><b>4</b> Publish</span>
        </div>
      </section>

      <div className="grid release-stats">
        <div className="card stat-card"><div className="stat-label">Needs technical review</div><div className="metric">{pending}</div><small className="muted">Candidates waiting for a decision</small></div>
        <div className="card stat-card"><div className="stat-label">Validation blocked</div><div className="metric">{blocked}</div><small className="muted">Failed checks or rejected candidates</small></div>
        <div className="card stat-card"><div className="stat-label">Approved for publish</div><div className="metric">{ready}</div><small className="muted">Validated Base candidates ready to publish</small></div>
        <div className="card stat-card"><div className="stat-label">Published Base</div><div className="metric">{published}</div><small className="muted">Customer-facing published releases</small></div>
      </div>

      <section className="section card">
        <div className="section-head">
          <div><div className="eyebrow">Authoritative queue</div><h2>Base candidates</h2><p className="muted">The release worker submits the package and release metadata. Nothing becomes publishable here until all technical checks pass and an operator approves it.</p></div>
          <div className="queue-header-actions"><span className="badge">{releases.length} total</span><Link className="button secondary" href="/releases">View updates</Link></div>
        </div>
        <TableTools targetId="base-release-list" filters={['pending','approved','rejected','published']} pageSize={3} />

        <div id="base-release-list" className="release-list">
          {releases.length === 0 ? <div className="empty-state"><strong>No Base candidates yet</strong><span>When the first V1 Base workflow completes its License Manager handoff, the candidate will appear here.</span></div> :
            releases.map((r: any) => {
              const v = validation(r);
              const archived = Boolean(r.archived_at);
              const state = archived ? 'archived' : r.status === 'published' ? 'published' : v.status === 'failed' || r.review_status === 'rejected' ? 'blocked' : r.review_status === 'approved' ? 'ready' : v.status === 'passed' ? 'validated' : 'needs validation';
              return <article className={archived ? 'release-item release-item-archived' : 'release-item'} data-row data-filter={`${r.review_status} ${r.status}`} data-search={`${r.version} ${r.channel} ${r.status} ${r.review_status} ${v.status} ${r.source_repo || ''} ${r.source_ref || ''} ${r.source_sha || ''}`} key={r.id}>
                <div className="release-item-top">
                  <div className="release-primary">
                    <div className="eyebrow">OrbitFS Base · {r.channel}</div>
                    <Link href={'/releases/' + r.id} className="release-title-link"><h3>{r.version}</h3></Link>
                    <div className="tag-row"><span className={state === 'ready' ? 'badge ok' : state === 'blocked' ? 'badge off' : 'badge'}>{state}</span><span className={r.status === 'published' ? 'badge ok' : 'badge'}>{r.status}</span><span className={r.review_status === 'approved' ? 'badge ok' : r.review_status === 'rejected' ? 'badge off' : 'badge'}>review {r.review_status}</span><span className={v.status === 'passed' ? 'badge ok' : v.status === 'failed' ? 'badge off' : 'badge'}>validation {v.status}</span></div>
                  </div>
                  <ReleaseQueueActions id={r.id} reviewStatus={r.review_status} validationStatus={v.status} published={r.status === 'published'} archived={archived} releaseType="base" />
                </div>
                <div className="release-meta release-meta-base">
                  <div><small className="muted">Source</small><strong>{r.source_repo || '—'}</strong><span>{r.source_ref || '—'}</span></div>
                  <div><small className="muted">Source commit</small><strong className="mono">{r.source_sha || '—'}</strong></div>
                  <div><small className="muted">Artifact</small><strong>{r.artifact_name || '—'}</strong><span>{r.artifact_url ? 'Legacy artifact URL supplied' : 'GitHub release asset reference'}</span></div>
                  <div><small className="muted">Validation</small><strong>{v.checks.filter((c: any) => c.ok).length}/{v.checks.length || 0} checks</strong><span>{v.status === 'passed' ? 'Technically valid' : v.status === 'failed' ? 'Fix required' : 'Not completed'}</span></div>
                </div>
                {v.status === 'failed' && <div className="release-blocker"><strong>Technical blocker</strong><span>{v.checks.find((c: any) => !c.ok)?.message || 'One or more validation checks failed.'}</span><Link href={'/releases/' + r.id}>Open validation report →</Link></div>}
              </article>;
            })}
        </div>
      </section>
    </main>
  </div>;
}
