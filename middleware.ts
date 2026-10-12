import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Deployed family is immutable; the shared License Manager database selects
// exactly one active family. Standby is NOT a second public operational API.
const DEPLOYED_FAMILY = 'fallback';
const API_HOST = 'lm.incendiarynetworks.cc';
const PANEL_HOST = 'lm.incendiarynetworks.cc';
const DISCOVERY = '/api/v1/source-configuration';

export async function middleware(request: NextRequest) {
  const host = request.nextUrl.hostname.toLowerCase();
  const pathname = request.nextUrl.pathname;

  // This read-only route is essential for starting the alternate system.
  // It reads shared authoritative state, never grants operational access.
  if (pathname !== DISCOVERY) {
    try {
      const status = await fetch(new URL(DISCOVERY, request.url), {
        cache: 'no-store',
        signal: AbortSignal.timeout(3500),
        headers: { accept: 'application/json' },
      });
      if (!status.ok) throw new Error('source discovery failed');
      const state = await status.json() as { mode?: string };
      if (state.mode !== DEPLOYED_FAMILY) {
        return NextResponse.json({ error: 'SOURCE_MODE_STANDBY', activeMode: state.mode ?? null }, {
          status: 503, headers: { 'cache-control': 'no-store' },
        });
      }
    } catch {
      // Never authorize an API from stale or unverifiable source-mode state.
      return NextResponse.json({ error: 'SOURCE_MODE_UNVERIFIED' }, {
        status: 503, headers: { 'cache-control': 'no-store' },
      });
    }
  }

  if (host === API_HOST) {
    if (pathname === '/') {
      const url = request.nextUrl.clone();
      url.pathname = '/api/v1/license/health';
      return NextResponse.rewrite(url);
    }
    if (!pathname.startsWith('/api/') && host !== PANEL_HOST) {
      return NextResponse.json({ error: 'API_HOST_ONLY', service: 'license-manager-api' }, { status: 404 });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
