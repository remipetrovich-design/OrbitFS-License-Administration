import { NextResponse } from 'next/server';
import { integrationAuthorized } from '../../../../../lib/auth';
import { db } from '../../../../../lib/db';

let channelAccessSchemaReady:Promise<void>|null=null;

async function ensureChannelAccessSchema(){
  if(channelAccessSchemaReady)return channelAccessSchemaReady;
  channelAccessSchemaReady=(async()=>{
    const database=db();
    await database.query(`
      create table if not exists public.release_channel_access (
        id uuid primary key default gen_random_uuid(),
        license_id uuid not null references public.licenses(id) on delete cascade,
        channel text not null references public.release_channels(channel) on delete cascade,
        granted_by text,
        external_reference text,
        expires_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(license_id,channel)
      );

      create table if not exists public.release_channel_access_requests (
        id uuid primary key default gen_random_uuid(),
        license_id uuid not null,
        channel text not null references public.release_channels(channel) on delete cascade,
        external_reference text,
        status text not null default 'pending'
          check(status in ('pending','approved','rejected','cancelled')),
        requested_at timestamptz not null default now(),
        reviewed_at timestamptz,
        reviewed_by text,
        reason text,
        request_details jsonb not null default '{}'::jsonb
      );
      alter table public.release_channel_access_requests
        add column if not exists request_details jsonb not null default '{}'::jsonb;
      alter table public.release_channel_access_requests
        drop constraint if exists release_channel_access_requests_license_id_channel_status_key;
      create unique index if not exists release_channel_access_requests_one_pending_idx
        on public.release_channel_access_requests(license_id,channel)
        where status='pending';

      create index if not exists release_channel_access_license_idx
        on public.release_channel_access(license_id,channel);
      create index if not exists release_channel_access_expiry_idx
        on public.release_channel_access(channel,expires_at);
      create index if not exists release_channel_access_requests_channel_status_idx
        on public.release_channel_access_requests(channel,status,requested_at desc);
      create index if not exists release_channel_access_requests_license_idx
        on public.release_channel_access_requests(license_id,status,requested_at desc);

      create or replace function touch_release_channel_access_updated_at()
      returns trigger language plpgsql
      set search_path = public
      as $$
      begin
        new.updated_at=now();
        return new;
      end $$;

      drop trigger if exists release_channel_access_touch on public.release_channel_access;
      create trigger release_channel_access_touch
      before update on public.release_channel_access
      for each row execute function touch_release_channel_access_updated_at();
    `);
  })().catch((error)=>{
    channelAccessSchemaReady=null;
    throw error;
  });
  return channelAccessSchemaReady;
}

export async function GET(request: Request) {
  const auth = await integrationAuthorized(request, 'releases.read');
  if (!auth) return NextResponse.json({ error: 'UNAUTHORIZED', code: 'UNAUTHORIZED' }, { status: 401 });
  try {
    await ensureChannelAccessSchema();
  } catch (error:any) {
    console.error('release channel access schema check failed', error);
    return NextResponse.json(
      { error:'RELEASE_CHANNEL_SCHEMA_UNAVAILABLE', code:'RELEASE_CHANNEL_SCHEMA_UNAVAILABLE' },
      { status:503 },
    );
  }
  const url = new URL(request.url);
  const channel = String(url.searchParams.get('channel') || '').trim().toLowerCase();
  const view = String(url.searchParams.get('view') || 'requests').trim().toLowerCase();
  const status = String(url.searchParams.get('status') || 'pending').trim().toLowerCase();
  const params:any[]=[]; const where:string[]=[];
  if(channel){params.push(channel);where.push(`channel=$${params.length}`);}
  if(view==='access'){
    const accessParams:any[]=[]; const accessWhere:string[]=[];
    if(channel){accessParams.push(channel);accessWhere.push(`channel=$${accessParams.length}`);}
    const access=(await db().query(
      `select a.*,coalesce(a.external_reference,l.customer_external_id) external_reference
       from release_channel_access a
       left join licenses l on l.id=a.license_id
       ${accessWhere.length?`where ${accessWhere.map((clause)=>`a.${clause}`).join(' and ')}`:''}
       order by a.channel,a.updated_at desc`,
      accessParams,
    )).rows;
    return NextResponse.json({access});
  }
  if(status!=='all'){params.push(status);where.push(`status=$${params.length}`);}
  const rows=(await db().query(
    `select r.*,coalesce(r.external_reference,l.customer_external_id) external_reference
     from release_channel_access_requests r
     left join licenses l on l.id=r.license_id
     ${where.length?`where ${where.map((clause)=>`r.${clause}`).join(' and ')}`:''}
     order by r.requested_at desc`,
    params,
  )).rows;
  return NextResponse.json({requests:rows});
}

export async function POST(request: Request) {
  const auth = await integrationAuthorized(request, 'releases.write');
  if (!auth) return NextResponse.json({ error: 'UNAUTHORIZED', code: 'UNAUTHORIZED' }, { status: 401 });

  try {
    await ensureChannelAccessSchema();
  } catch (error:any) {
    console.error('release channel access schema check failed', error);
    return NextResponse.json(
      { error:'RELEASE_CHANNEL_SCHEMA_UNAVAILABLE', code:'RELEASE_CHANNEL_SCHEMA_UNAVAILABLE' },
      { status:503 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || (body.revoke ? 'revoke' : 'grant')).trim().toLowerCase();
  let licenseId = String(body.license_id || body.licenseId || '').trim();
  const channel = String(body.channel || '').trim().toLowerCase();
  const externalReference = body.external_reference ?? body.externalReference ?? null;
  if (!licenseId && externalReference) {
    const resolved = (
      await db().query(
        `select l.id
         from licenses l
         join products p on p.id=l.product_id
         where l.customer_external_id=$1
           and p.slug='orbitfs_base'
           and l.status='active'
           and (l.expires_at is null or l.expires_at>now())
         order by l.created_at desc
         limit 1`,
        [String(externalReference)],
      )
    ).rows[0];
    licenseId = String(resolved?.id || '');
  }
  const rawRequestDetails = body.request_details ?? body.requestDetails ?? {};
  const requestDetails:{use_case:string;environment:string;notes:string} =
    rawRequestDetails && typeof rawRequestDetails === 'object' && !Array.isArray(rawRequestDetails)
      ? {
          use_case: String(rawRequestDetails.use_case ?? rawRequestDetails.useCase ?? '').trim().slice(0, 500),
          environment: String(rawRequestDetails.environment ?? '').trim().slice(0, 80),
          notes: String(rawRequestDetails.notes ?? '').trim().slice(0, 500),
        }
      : {use_case:'',environment:'',notes:''};

  if (!licenseId) return NextResponse.json({ error: 'ACTIVE_BASE_LICENSE_REQUIRED', code:'ACTIVE_BASE_LICENSE_REQUIRED' }, { status: 403 });

  if (action === 'list_access') {
    const rows = (await db().query(
      `select * from release_channel_access where license_id=$1 order by channel`,
      [licenseId],
    )).rows;
    return NextResponse.json({ access: rows });
  }

  if (action === 'list_requests') {
    const rows = (await db().query(
      `select * from release_channel_access_requests where license_id=$1 order by requested_at desc`,
      [licenseId],
    )).rows;
    return NextResponse.json({ requests: rows });
  }

  if (!channel) return NextResponse.json({ error: 'CHANNEL_REQUIRED', code:'CHANNEL_REQUIRED' }, { status: 400 });
  const channelRow = (
    await db().query(
      'select id,access_mode,enabled,customer_visible,access_request_enabled,self_join_enabled from release_channels where channel=$1 limit 1',
      [channel],
    )
  ).rows[0];

  if (!channelRow) return NextResponse.json({ error: 'CHANNEL_NOT_FOUND', code:'CHANNEL_NOT_FOUND' }, { status: 404 });
  if (!channelRow.enabled || !channelRow.customer_visible) return NextResponse.json({ error: 'CHANNEL_UNAVAILABLE', code:'CHANNEL_UNAVAILABLE' }, { status: 409 });

  if (action === 'request') {
    if (!channelRow.access_request_enabled) return NextResponse.json({ error: 'ACCESS_REQUESTS_DISABLED' }, { status: 409 });
    if (channelRow.access_mode === 'open' || channelRow.self_join_enabled) return NextResponse.json({ error: 'CHANNEL_DOES_NOT_REQUIRE_REQUEST' }, { status: 409 });
    const existing = (await db().query(
      'select * from release_channel_access_requests where license_id=$1 and channel=$2 and status=$3 limit 1',
      [licenseId, channel, 'pending'],
    )).rows[0];
    if (existing) return NextResponse.json({ request: existing, existing: true });
    if (!requestDetails.use_case) return NextResponse.json({ error: 'REQUEST_USE_CASE_REQUIRED', code:'REQUEST_USE_CASE_REQUIRED' }, { status: 400 });
    if (!requestDetails.environment) return NextResponse.json({ error: 'REQUEST_ENVIRONMENT_REQUIRED', code:'REQUEST_ENVIRONMENT_REQUIRED' }, { status: 400 });
    const row = (await db().query(
      `insert into release_channel_access_requests(license_id,channel,external_reference,status,request_details)
       values($1,$2,$3,'pending',$4::jsonb) returning *`,
      [licenseId, channel, externalReference, JSON.stringify(requestDetails)],
    )).rows[0];
    return NextResponse.json({ request: row }, { status: 201 });
  }

  if (action === 'grant' || action === 'join') {
    if (action === 'join' && channelRow.access_mode !== 'open' && !channelRow.self_join_enabled) {
      return NextResponse.json({ error: 'SELF_JOIN_DISABLED' }, { status: 403 });
    }
    const row = (await db().query(
      `insert into release_channel_access(license_id,channel,granted_by,external_reference)
       values($1,$2,$3,$4)
       on conflict(license_id,channel) do update
       set granted_by=excluded.granted_by,external_reference=excluded.external_reference,updated_at=now()
       returning *`,
      [licenseId, channel, auth.name, externalReference],
    )).rows[0];
    if (action === 'grant') {
      await db().query(
        `update release_channel_access_requests
         set status='approved',reviewed_at=now(),reviewed_by=$3
         where license_id=$1 and channel=$2 and status='pending'`,
        [licenseId, channel, auth.name],
      );
    }
    return NextResponse.json({ access: row });
  }

  if (action === 'revoke') {
    const row = (await db().query(
      'delete from release_channel_access where license_id=$1 and channel=$2 returning *',
      [licenseId, channel],
    )).rows[0];
    return NextResponse.json({ access: row ?? null, revoked: Boolean(row) });
  }

  if (action === 'reject') {
    const row = (await db().query(
      `update release_channel_access_requests
       set status='rejected',reviewed_at=now(),reviewed_by=$3,reason=$4
       where license_id=$1 and channel=$2 and status='pending' returning *`,
      [licenseId, channel, auth.name, body.reason ? String(body.reason) : null],
    )).rows[0];
    return NextResponse.json({ request: row ?? null });
  }

  return NextResponse.json({ error: 'UNSUPPORTED_ACCESS_ACTION' }, { status: 400 });
}
