import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const API_HOST = 'incendiarynetworks.cc';
const PANEL_HOST = 'panel.incendiarynetworks.cc';

export function middleware(request: NextRequest) {
  const host = request.nextUrl.hostname.toLowerCase();
  const pathname = request.nextUrl.pathname;

  if (host === API_HOST) {
    if (pathname === '/') {
      const url = request.nextUrl.clone();
      url.pathname = '/api/v1/license/health';
      return NextResponse.rewrite(url);
    }
    if (!pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'API_HOST_ONLY', service: 'license-manager-api' }, { status: 404 });
    }
  }

  if (host === PANEL_HOST && pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
