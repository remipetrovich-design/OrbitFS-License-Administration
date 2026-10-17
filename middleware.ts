import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Deployed family is immutable; the shared License Manager database selects
// exactly one active family. Standby is NOT a second public operational API.
const DEPLOYED_FAMILY = 'fallback';
const DISCOVERY = '/api/v1/source-configuration';

export async function middleware(request: NextRequest) {
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
      const state = await status.json() as { mode?: string; handoverMode?: boolean };
      // Handover Mode is a server-enforced minimal operating state, not
      // merely a set of disabled switches in the admin dashboard.
      if (state.mode === DEPLOYED_FAMILY && state.handoverMode === true) {
        const admin =
          pathname === '/' ||
          pathname === '/settings' || pathname.startsWith('/settings/') ||
          pathname === '/login' || pathname.startsWith('/login/') ||
          pathname === '/logout' || pathname.startsWith('/logout/') ||
          pathname.startsWith('/api/auth/');
        const coordination =
          pathname === DISCOVERY ||
          pathname === '/api/v1/source-routing' ||
          pathname === '/api/v1/github-profile' ||
          pathname === '/api/v1/source-handover' ||
          pathname === '/api/v1/license/health' ||
          pathname.startsWith('/api/v1/license/pulse');
        if (!admin && !coordination) {
          return NextResponse.json({ error: 'HANDOVER_MINIMAL_MODE' }, {
            status: 503, headers: { 'cache-control': 'no-store' },
          });
        }
      }
      if (state.mode !== DEPLOYED_FAMILY) {
        // Installed runtimes may still be pinned to their former API.
        // Allow only read-only pulse discovery so they can learn the new
        // authority and inner-deployer source; block every standby mutation.
        if (pathname === '/api/v1/license/pulse' && request.method === 'GET') {
          return NextResponse.next();
        }
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

  // The same public host serves the authenticated admin UI and /api/v1/* API.
  // Source-family and handover restrictions above remain authoritative.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
