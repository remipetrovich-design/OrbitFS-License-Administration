'use client';

import { useActionState } from 'react';
import { runReleaseAction, type ReleaseCheck } from '../releases/[id]/actions';

type Props = {
  id: string;
  reviewStatus: string;
  validationStatus: string;
  published: boolean;
  archived: boolean;
  releaseType: string;
};

type State = {
  ok: boolean;
  message: string;
  checks: ReleaseCheck[];
  checkedAt?: string;
};

const initial: State = { ok: false, message: '', checks: [] };

export default function ReleaseQueueActions({
  id,
  reviewStatus,
  validationStatus,
  published,
  archived,
  releaseType,
}: Props) {
  const [state, action, pending] = useActionState(runReleaseAction, initial);
  const canReview = !published && reviewStatus === 'pending';
  const checks = state.checks ?? [];

  return (
    <div className="queue-actions">
      {!published && (
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="action" value="validate" />
          <button className="button" disabled={pending}>
            {pending
              ? 'Checking...'
              : validationStatus === 'passed'
                ? 'Re-run checks'
                : 'Validate release'}
          </button>
        </form>
      )}

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
            placeholder="Reject reason"
            required
          />
          <button className="button danger" disabled={pending}>
            Reject
          </button>
        </form>
      )}

      {!published && !archived && releaseType === 'base' && reviewStatus === 'approved' && validationStatus === 'passed' && (
        <form action={action} onSubmit={(e) => { if (!confirm('Publish this validated Base release?')) e.preventDefault(); }}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="action" value="publish" />
          <button className="button" disabled={pending}>Publish Base</button>
        </form>
      )}

      {!archived && <form action={action}><input type="hidden" name="id" value={id} /><input type="hidden" name="action" value="archive" /><button className="button secondary" disabled={pending}>Archive</button></form>}

      {state.message && (
        <div className={state.ok ? 'notice okBox' : 'notice dangerBox'} aria-live="polite">
          <strong>{state.message}</strong>
          {state.checkedAt && (
            <div className="muted">
              Checked {new Date(state.checkedAt).toLocaleString()}
            </div>
          )}
          {checks.length > 0 && (
            <details className="inline-validation" open>
              <summary>
                {checks.filter((check) => check.ok).length}/{checks.length} checks passed
              </summary>
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
            </details>
          )}
        </div>
      )}
    </div>
  );
}
