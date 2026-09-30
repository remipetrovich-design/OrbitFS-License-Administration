import { NextResponse } from 'next/server';
import { integrationAuthorized } from '../../../../lib/auth';
import { listReleaseChannels, saveReleaseChannel } from '../../../../lib/core/release-channels';

export async function GET(request: Request) {
  const auth = await integrationAuthorized(request, 'releases.read');
  if (!auth) return NextResponse.json({ error: 'UNAUTHORIZED', code: 'UNAUTHORIZED' }, { status: 401 });

  return NextResponse.json({
    channels: await listReleaseChannels(request.url.includes('include_disabled=true')),
  });
}

export async function POST(request: Request) {
  const auth = await integrationAuthorized(request, 'releases.write');
  if (!auth) return NextResponse.json({ error: 'UNAUTHORIZED', code: 'UNAUTHORIZED' }, { status: 401 });

  const body = await request.json().catch(() => ({}));

  try {
    return NextResponse.json({
      channel: await saveReleaseChannel({
        channel: body.channel,
        label: body.label,
        description: body.description,
        enabled: body.enabled,
        customerVisible: body.customer_visible ?? body.customerVisible,
        accessMode: body.access_mode ?? body.accessMode,
        accessRequestEnabled: body.access_request_enabled ?? body.accessRequestEnabled,
        selfJoinEnabled: body.self_join_enabled ?? body.selfJoinEnabled,
        sortOrder: body.sort_order ?? body.sortOrder,
        actor: `api:${auth.name}`,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save release channel' },
      { status: 400 },
    );
  }
}
