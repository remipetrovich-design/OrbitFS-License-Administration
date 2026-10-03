import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const started=Date.now();
  try {
    const result = await db().query(
      'select system_name,system_enabled,licensing_enabled,release_system_enabled,deployment_enabled,maintenance_mode,validation_ttl_seconds,offline_grace_seconds,pulse_poll_seconds,max_failed_validations,allow_offline_grace,pulse_revision,pulse_at,pulse_reason from system_settings where id=true',
    );
    const settings = result.rows[0];

    return NextResponse.json({
      ok: true,
      service: 'license-manager',
      api_version: 'v1',
      authority: 'orbitfs-license-master',
      latency_ms: Date.now()-started,
      capabilities: {
        license_validation: Boolean(settings?.system_enabled&&settings?.licensing_enabled&&!settings?.maintenance_mode),
        license_issuance: Boolean(settings?.system_enabled&&settings?.licensing_enabled&&!settings?.maintenance_mode),
        releases: Boolean(settings?.system_enabled&&settings?.release_system_enabled),
        deployment: Boolean(settings?.system_enabled&&settings?.deployment_enabled),
      },
      system_name: settings?.system_name ?? 'License Manager',
      external_authority_online: Boolean(settings?.system_enabled),
      licensing_enabled: Boolean(settings?.licensing_enabled),
      maintenance_mode: Boolean(settings?.maintenance_mode),
      authority_reason: !settings?.system_enabled ? 'manual_shutdown' : !settings?.licensing_enabled ? 'licensing_disabled' : settings?.maintenance_mode ? 'maintenance' : null,
      provider_outage: false,
      grace_action: 'normal',
      failure_counter_action: 'normal',
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
    const requestId=crypto.randomUUID();
    console.error('license manager health check failed',{requestId,error});
    return NextResponse.json(
      { ok: false, service: 'license-manager', api_version:'v1', authority:'orbitfs-license-master', code: 'DATABASE_UNAVAILABLE', request_id:requestId, authority_reason: 'provider_failure', provider_outage: true, grace_action: 'freeze', failure_counter_action: 'freeze' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
