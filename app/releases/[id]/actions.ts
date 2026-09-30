'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '../../../lib/session';
import { db } from '../../../lib/db';
import {
  archiveRelease,
  promoteRelease,
  publishRelease,
  rollbackBaseRelease,
  withdrawRelease,
  setReleaseReview,
  validateRelease,
} from '../../../lib/core/releases';

export type ReleaseCheck = {
  key: string;
  ok: boolean;
  message: string;
};

type ActionState = {
  ok: boolean;
  message: string;
  checks?: ReleaseCheck[];
  checkedAt?: string;
};

const roles = ['owner', 'admin', 'operator'];

function refreshRelease(id: string) {
  revalidatePath('/releases');
  revalidatePath('/releases/base');
  revalidatePath('/releases/' + id);
}

export async function runReleaseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUser();

    if (!roles.includes(user.role)) {
      return {
        ok: false,
        message: 'You do not have permission to operate releases.',
      };
    }

    const id = String(formData.get('id') || '').trim();
    const action = String(formData.get('action') || '').trim();

    if (!id) {
      return { ok: false, message: 'Release ID is missing.' };
    }

    if (action === 'validate') {
      const row = await validateRelease(id, user.id, user.email);

      if (!row) {
        return { ok: false, message: 'Release not found.' };
      }

      refreshRelease(id);

      const validation = row.manifest?.validation || {};
      const checks = Array.isArray(validation.checks)
        ? validation.checks
        : [];

      return {
        ok: validation.status === 'passed',
        message:
          validation.status === 'passed'
            ? 'Validation passed. Release is ready for technical approval.'
            : 'Validation completed with failures. Review the failed checks below.',
        checks,
        checkedAt: validation.checked_at,
      };
    }

    if (action === 'approve' || action === 'reject') {
      const reason = String(formData.get('reason') || '').trim();

      if (action === 'reject' && !reason) {
        return { ok: false, message: 'A rejection reason is required.' };
      }

      const row = await setReleaseReview(
        id,
        action === 'approve' ? 'approved' : 'rejected',
        user.id,
        user.email,
        reason || undefined,
      );

      if (!row) {
        return { ok: false, message: 'Release not found.' };
      }

      refreshRelease(id);

      return {
        ok: true,
        message:
          action === 'approve'
            ? 'Technical approval recorded. Candidate is ready for Billing Store final review.'
            : 'Release rejected and held out of publication.',
      };
    }

    if (action === 'promote') {
      const targetChannel = String(
        formData.get('target_channel') || '',
      )
        .trim()
        .toLowerCase();

      if (!targetChannel) {
        return { ok: false, message: 'Target channel is required.' };
      }

      const row = await promoteRelease(
        id,
        targetChannel,
        user.id,
        user.email,
      );

      if (!row) {
        return { ok: false, message: 'Release not found.' };
      }

      refreshRelease(id);
      refreshRelease(row.id);

      const validation = row.manifest?.validation || {};
      const checks = Array.isArray(validation.checks)
        ? validation.checks
        : [];

      return {
        ok: validation.status === 'passed',
        message:
          validation.status === 'passed'
            ? 'Release promoted and passed technical validation in the target channel.'
            : 'Release promoted to ' +
              targetChannel +
              ' as a new technical-review candidate. Validation requires attention.',
        checks,
        checkedAt: validation.checked_at,
      };
    }

    if (action === 'publish') {
      const release = (await db().query('select release_type from releases where id=$1 limit 1', [id])).rows[0];
      if (!release) return { ok: false, message: 'Release not found.' };
      if (release.release_type !== 'base') {
        return { ok: false, message: 'Update releases are published by Billing Store after License Manager technical approval.' };
      }
      const row = await publishRelease(id, user.id, user.email);
      if (!row) return { ok: false, message: 'Release could not be published.' };
      refreshRelease(id);
      return { ok: true, message: 'Base release published. It is now available to the customer-facing Base deployment flow.' };
    }

    if (action === 'withdraw') {
      const row = await withdrawRelease(id, user.id, user.email);
      if (!row) return { ok: false, message: 'Release not found.' };
      refreshRelease(id);
      return { ok: true, message: 'Published release withdrawn. It is no longer active and can now be archived while its history is retained.' };
    }

    if (action === 'rollback') {
      const row = await rollbackBaseRelease(id, user.id, user.email);
      if (!row) return { ok: false, message: 'Rollback candidate could not be created.' };
      refreshRelease(id);
      refreshRelease(row.id);
      const validation = row.manifest?.validation || {};
      const checks = Array.isArray(validation.checks) ? validation.checks : [];
      return {
        ok: validation.status === 'passed',
        message: validation.status === 'passed'
          ? 'Rollback candidate created and validated. Approve it to return the previous Base deployment to the publication queue.'
          : 'Rollback candidate created, but validation needs attention before approval.',
        checks,
        checkedAt: validation.checked_at,
      };
    }

    if (action === 'archive') {
      const row = await archiveRelease(id, true, user.id, user.email);
      if (!row) return { ok: false, message: 'Release not found.' };
      refreshRelease(id);
      return { ok: true, message: 'Release archived.' };
    }

    return { ok: false, message: 'Unsupported release action.' };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : 'Release operation failed.',
      checks: [],
    };
  }
}
