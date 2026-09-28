import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const result = await db().query(
      'select system_name,system_enabled,licensing_enabled,maintenance_mode from system_settings where id=true',
    );
    const settings = result.rows[0];
    return NextResponse.json({
      ok: true,
      service: 'license-manager',
      system_name: settings?.system_name ?? 'License Manager',
      external_authority_online: Boolean(settings?.system_enabled),
      licensing_enabled: Boolean(settings?.licensing_enabled),
      maintenance_mode: Boolean(settings?.maintenance_mode),
    });
  } catch {
    return NextResponse.json({ ok: false, service: 'license-manager', code: 'DATABASE_UNAVAILABLE' }, { status: 503 });
  }
}
