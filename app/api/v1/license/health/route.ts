import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await db().query(
      'select system_name,system_enabled,licensing_enabled,maintenance_mode,validation_ttl_seconds,offline_grace_seconds,pulse_poll_seconds,max_failed_validations,allow_offline_grace,pulse_revision,pulse_at,pulse_reason from system_settings where id=true',
    );
    const settings = result.rows[0];

    return NextResponse.json({
      ok: true,
      service: 'license-manager',
      system_name: settings?.system_name ?? 'License Manager',
      external_authority_online: Boolean(settings?.system_enabled),
      licensing_enabled: Boolean(settings?.licensing_enabled),
      maintenance_mode: Boolean(settings?.maintenance_mode),
      pulse_revision: Number(settings?.pulse_revision||0),
      pulse_at: settings?.pulse_at??null,
      pulse_reason: settings?.pulse_reason??null,
      runtime_policy: {
        validation_ttl_seconds:Number(settings?.validation_ttl_seconds||60),
        offline_grace_seconds:Number(settings?.offline_grace_seconds||0),
        pulse_poll_seconds:Number(settings?.pulse_poll_seconds||15),
        max_failed_validations:Number(settings?.max_failed_validations||3),
        allow_offline_grace:Boolean(settings?.allow_offline_grace),
      },
    });
  } catch (error) {
    console.error('legacy health check failed', error);
    return NextResponse.json(
      { ok: false, service: 'license-manager', code: 'DATABASE_UNAVAILABLE' },
      { status: 503 },
    );
  }
}
