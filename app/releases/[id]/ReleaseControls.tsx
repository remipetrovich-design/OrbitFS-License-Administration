'use client';

import { useActionState } from 'react';
import { runReleaseAction, type ReleaseCheck } from './actions';

type State = {
  ok: boolean;
  message: string;
  checks: ReleaseCheck[];
  checkedAt?: string;
};

const initial: State = { ok: false, message: '', checks: [] };

export default function ReleaseControls({
  id,
  reviewStatus,
  validationStatus,
  published,
  archived,
  channels,
  releaseType,
}: {
  id: string;
  reviewStatus: string;
  validationStatus: string;
  published: boolean;
  archived: boolean;
  channels: string[];
  releaseType: string;
}) {
  const [state, action, pending] = useActionState(runReleaseAction, initial);
  const canReview = !published && reviewStatus === 'pending';
  const checks = state.checks ?? [];

  return (
    <div className="release-controls">
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="action" value="validate" />
        <button className="button" disabled={pending || published}>
          {pending
            ? 'Running checks...'
            : validationStatus === 'passed'
              ? 'Re-run full validation'
              : 'Run full validation'}
        </button>
      </form>

      {canReview && validationStatus === 'passed' && (
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="action" value="approve" />
          <button className="button" disabled={pending}>
            Technical approve
          </button>
        </form>
      )}

      {canReview && (
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="action" value="reject" />
          <input
            className="input compact-input"
            name="reason"
            placeholder="Rejection reason"
            required
          />
          <button className="button danger" disabled={pending}>
            Reject
          </button>
        </form>
      )}

      {!published && !archived && releaseType === 'base' && reviewStatus === 'approved' && validationStatus === 'passed' && (
        <form action={action} onSubmit={(e) => { if (!confirm('Publish this validated Base release to the customer Base deployment flow?')) e.preventDefault(); }}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="action" value="publish" />
          <button className="button" disabled={pending}>Publish Base</button>
        </form>
      )}

      {published && releaseType === 'base' && (
        <>
          <form action={action} onSubmit={(e) => { if (!confirm('Withdraw this published Base deployment? It will stop being active and can then be archived.')) e.preventDefault(); }}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="action" value="withdraw" />
            <button className="button danger" disabled={pending}>Withdraw deployment</button>
          </form>
          <form action={action} onSubmit={(e) => { if (!confirm('Prepare a rollback to the previous published Base deployment?')) e.preventDefault(); }}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="action" value="rollback" />
            <button className="button secondary" disabled={pending}>Prepare rollback</button>
          </form>
        </>
      )}

      {!archived && (
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="action" value="archive" />
          <button className="button secondary" disabled={pending}>
            Archive
          </button>
        </form>
      )}

      {channels.length > 0 && (
        <form action={action} className="promote-form">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="action" value="promote" />
          <select className="input compact-input" name="target_channel" defaultValue="">
            <option value="" disabled>
              Promote to...
            </option>
            {channels.map((channel) => (
              <option value={channel} key={channel}>
                {channel}
              </option>
            ))}
          </select>
          <button className="button secondary" disabled={pending}>
            Promote
          </button>
        </form>
      )}

      {state.message && (
        <div className={state.ok ? 'notice okBox' : 'notice dangerBox'} aria-live="polite">
          <strong>{state.message}</strong>
          {state.checkedAt && (
            <div className="muted">
              Checked {new Date(state.checkedAt).toLocaleString()}
            </div>
          )}
          {checks.length > 0 && (
            <div className="operation-checks">
              {checks.map((check, index) => (
                <div
                  className={check.ok ? 'operation-check ok' : 'operation-check fail'}
                  key={check.key + index}
                >
                  <span>{check.ok ? 'OK' : 'FAIL'}</span>
                  <div>
                    <strong>{check.key}</strong>
                    <div>{check.message}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
