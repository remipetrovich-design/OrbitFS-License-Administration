import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'license-master',
    api_version: 'v1',
    base_path: '/api/v1',
    endpoints: {
      health: '/api/v1/license/health',
      license: '/api/v1/license',
      validate: '/api/v1/license/validate',
      products: '/api/v1/products',
      releases: '/api/v1/releases',
      updater: '/api/v1/updater',
      deployer: '/api/v1/deployer',
    },
  });
}
