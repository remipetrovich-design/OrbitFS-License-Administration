import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const API_HOST = 'incendiarynetworks.cc';
const PANEL_HOST = 'panel.incendiarynetworks.cc';
const LOCKDOWN_ALLOWED = new Set([
  '/api/v1/lockdown/status',
  '/api/v1/lockdown/recover',
]);

async function lockdownState(request:NextRequest){
  const url=request.nextUrl.clone();
  url.pathname='/api/v1/lockdown/status';
  url.search='';
  try{
    const response=await fetch(url,{cache:'no-store',headers:{'x-orbitfs-lockdown-probe':'1'}});
    const body=await response.json().catch(()=>({}));
    if(!response.ok)return {locked:true,message:'OrbitFS authority state is unavailable. Access is temporarily blocked.',code:'LOCKDOWN_STATE_UNAVAILABLE'};
    return {locked:Boolean(body?.locked),message:String(body?.message||'OrbitFS is temporarily locked by system administration. Access is currently unavailable.'),code:String(body?.code||'AUTHORITY_AVAILABLE')};
  }catch{
    return {locked:true,message:'OrbitFS authority state is unavailable. Access is temporarily blocked.',code:'LOCKDOWN_STATE_UNAVAILABLE'};
  }
}

export async function middleware(request: NextRequest) {
  const host = request.nextUrl.hostname.toLowerCase();
  const pathname = request.nextUrl.pathname;

  if(!LOCKDOWN_ALLOWED.has(pathname)){
    const state=await lockdownState(request);
    if(state.locked){
      if(pathname.startsWith('/api/')){
        return NextResponse.json({
          ok:false,
          error:'AUTHORITY_LOCKDOWN',
          code:state.code==='LOCKDOWN_STATE_UNAVAILABLE'?state.code:'AUTHORITY_LOCKDOWN',
          message:state.message,
        },{status:state.code==='LOCKDOWN_STATE_UNAVAILABLE'?503:423,headers:{'cache-control':'no-store'}});
      }
      return new NextResponse(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OrbitFS Locked</title></head><body style="margin:0;background:#0d0d0d;color:#f2f2f2;font-family:system-ui,sans-serif;display:grid;min-height:100vh;place-items:center"><main style="max-width:560px;padding:32px;text-align:center"><h1 style="font-size:24px">OrbitFS access locked</h1><p style="color:#aaa;line-height:1.6">${state.message.replace(/[<>&"]/g,(c)=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]||c))}</p><p style="color:#666;font-size:12px">AUTHORITY_LOCKDOWN</p></main></body></html>`,
        {status:423,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}}
      );
    }
  }

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
