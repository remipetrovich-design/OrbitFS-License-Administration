import Link from 'next/link';
import { requireUser } from '../../../lib/session';
import { db } from '../../../lib/db';
import SideNav from '../../components/SideNav';
import LiveRefresh from '../../components/LiveRefresh';
import ReleaseControls from './ReleaseControls';

export const dynamic = 'force-dynamic';

export default async function ReleaseDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const release: any = (await db().query('select r.*,p.slug product,p.name product_name from releases r join products p on p.id=r.product_id where r.id=$1 limit 1', [id])).rows[0];
  if (!release) return <div className="shell"><SideNav /><main className="main"><h1 className="title">Release not found</h1><Link href="/releases">Back to releases</Link></main></div>;

  const validation = release.manifest?.validation || {};
  const checks = Array.isArray(validation.checks) ? validation.checks : [];
  const manifest = release.manifest || {};
  const channels = (await db().query('select channel from release_channels where enabled=true and channel<>$1 order by sort_order,channel', [release.channel])).rows.map((x: any) => x.channel);
  const passed = checks.filter((c: any) => c.ok).length;
  const failed = checks.length - passed;
  const audit = (await db().query("select id,actor,action,details,created_at from audit_events where resource_type='release' and resource_id=$1 order by created_at desc limit 25", [id])).rows;
  const isBase = release.release_type === 'base';
  const technicalReady = validation.status === 'passed' && release.review_status === 'approved';
  const pipeline = [
    ['Intake', Boolean(release.source_sha && release.artifact_name), 'Package received from release worker'],
    ['Validation', validation.status === 'passed', validation.status === 'passed' ? 'All technical checks passed' : 'Run validation'],
    ['Approval', release.review_status === 'approved', release.review_status === 'approved' ? 'Technical decision recorded' : 'Awaiting operator decision'],
    [isBase ? 'Publish' : 'Billing Store', isBase ? release.status === 'published' : technicalReady, isBase ? (release.status === 'published' ? 'Base release is published for customer deployment' : 'Publish after technical approval') : (technicalReady ? 'Candidate is ready for final customer publication' : 'Locked until technical approval')],
  ];

  return <div className="shell">
    <SideNav active={isBase ? 'base' : 'releases'} />
    <main className="main release-detail-main">
      <div className="detail-toolbar"><Link href={isBase ? '/releases/base' : '/releases'} className="back-link">← Back to queue</Link><LiveRefresh /></div>

      <header className="release-detail-header">
        <div>
          <div className="eyebrow">Release authority / {release.release_type === 'base' ? 'Base' : 'Update'}</div>
          <h1 className="title">{release.product_name || release.product} <span>{release.version}</span></h1>
          <p className="page-description">{release.channel} channel · {release.release_type} release · <span className="mono">{release.id}</span></p>
        </div>
        <div className="actions"><span className={release.status === 'published' ? 'badge ok' : 'badge'}>{release.status}</span><span className={validation.status === 'passed' ? 'badge ok' : validation.status === 'failed' ? 'badge off' : 'badge'}>validation {validation.status || 'not run'}</span><span className={release.review_status === 'approved' ? 'badge ok' : release.review_status === 'rejected' ? 'badge off' : 'badge'}>review {release.review_status}</span></div>
      </header>

      <section className="card release-gate">
        <div className="gate-heading"><div><div className="eyebrow">Authority gate</div><h2>{isBase && release.status === 'published' ? 'Base release is published' : technicalReady ? (isBase ? 'Base release is technically cleared for publication' : 'Technically cleared for Billing Store') : validation.status === 'failed' ? 'Release is blocked by validation' : 'Release is still in technical review'}</h2><p className="muted">{isBase && release.status === 'published' ? 'The published Base release is available to the customer-facing Base deployment flow.' : technicalReady ? (isBase ? 'Publish this Base release here after the final Base Deployment review.' : 'The License Manager has completed technical approval. Billing Store can now perform the final customer-facing update publication review.') : 'The License Manager owns the technical decision. Fix failures, validate again, then approve the candidate.'}</p></div><div className={technicalReady ? 'gate-icon gate-ok' : validation.status === 'failed' ? 'gate-icon gate-fail' : 'gate-icon'}>{technicalReady ? '✓' : validation.status === 'failed' ? '!' : '…'}</div></div>
        <div className="release-detail-pipeline">{pipeline.map(([label, done, sub], i) => <div className={done ? 'pipeline-node done' : 'pipeline-node'} key={String(label)}><span>{done ? '✓' : String(i + 1).padStart(2, '0')}</span><div><strong>{label}</strong><small>{sub}</small></div></div>)}</div>
      </section>

      <div className="detail-grid">
        <section className="card operation-card"><div className="card-heading"><div><div className="eyebrow">Operator actions</div><h2>Control this release</h2><p className="muted">Every decision is permission-checked and written to the audit trail.</p></div></div><ReleaseControls id={release.id} reviewStatus={release.review_status} validationStatus={validation.status || 'not run'} published={release.status === 'published'} archived={Boolean(release.archived_at)} channels={channels} releaseType={release.release_type} /></section>

        <section className="card validation-card"><div className="card-heading"><div><div className="eyebrow">Technical report</div><h2>Validation checks</h2></div><span className={validation.status === 'passed' ? 'badge ok' : validation.status === 'failed' ? 'badge off' : 'badge'}>{passed}/{checks.length} passed</span></div>{validation.checked_at && <p className="muted validation-time">Last checked {new Date(validation.checked_at).toLocaleString()}</p>}{checks.length ? <div className="check-list">{checks.map((c:any,i:number)=><div className={c.ok ? 'check-row ok' : 'check-row fail'} key={c.key || i}><span className="check-symbol">{c.ok ? '✓' : '×'}</span><div className="check-content"><strong>{c.key || 'check'}</strong><div>{c.message}</div>{!c.ok && <div className="fix-box"><b>Fix:</b> {c.fix || 'Inspect the failed release/build condition, correct it at the source, then run validation again.'}</div>}</div></div>)}</div> : <div className="empty-state"><strong>Validation has not run</strong><span>Run the full validation from Operator actions.</span></div>}</section>
      </div>

      <div className="detail-grid detail-lower">
        <section className="card"><div className="eyebrow">Immutable release evidence</div><h2>Release record</h2><div className="record-grid"><div><small className="muted">Source</small><strong>{release.source_repo || '—'}</strong><span>{release.source_ref || '—'}</span></div><div><small className="muted">Commit</small><strong className="mono">{release.source_sha || '—'}</strong></div><div><small className="muted">Artifact</small><strong>{release.artifact_name || '—'}</strong><span>{release.artifact_run_id ? 'CI run ' + release.artifact_run_id : 'No CI run recorded'}</span></div><div><small className="muted">Checksum</small><strong className="mono">{release.checksum || '—'}</strong></div></div><div className="record-wide"><small className="muted">{isBase ? 'Base publication' : 'Billing Store handoff'}</small><strong>{isBase ? (release.status === 'published' ? 'Published by License Manager' : 'License Manager Base Deployment Review') : (release.customer_publication_repo || 'lucaskerim123/V2_Billing_Store')}</strong><span>{isBase ? (release.status === 'published' ? 'Available to customer Base deployer.' : technicalReady ? 'Approved — ready to publish here.' : 'Locked until technical approval.') : (technicalReady ? 'Technically approved — awaiting Billing Store final publication.' : 'Locked until technical approval.')}</span></div></section>
        <section className="card"><div className="eyebrow">Release metadata</div><h2>Changelog & manifest</h2><div className="changelog-box">{release.notes || release.manifest?.releaseNotes || 'No changelog supplied.'}</div><div className="manifest-list"><div><small className="muted">Components</small><strong>{(manifest.components || []).join(', ') || 'base'}</strong></div><div><small className="muted">Minimum Base</small><strong>{manifest.minimum_version || manifest.minimumBaseVersion || '—'}</strong></div><div><small className="muted">Revision</small><strong>{release.revision}</strong></div></div><details className="manifest-details"><summary>Raw manifest</summary><pre className="code-panel">{JSON.stringify(manifest, null, 2)}</pre></details></section>
      </div>

      <section className="card audit-card"><div className="card-heading"><div><div className="eyebrow">Traceability</div><h2>Audit trail</h2></div><span className="badge">{audit.length} events</span></div>{audit.length ? <div className="audit-list">{audit.map((a:any) => <div className="audit-row" key={a.id}><div><strong>{a.action}</strong><span className="muted">{a.actor}</span></div><time className="muted">{new Date(a.created_at).toLocaleString()}</time><pre className="audit-details">{JSON.stringify(a.details, null, 2)}</pre></div>)}</div> : <div className="empty-state"><strong>No audit events yet</strong><span>Actions on this release will appear here.</span></div>}</section>
    </main>
  </div>;
}
