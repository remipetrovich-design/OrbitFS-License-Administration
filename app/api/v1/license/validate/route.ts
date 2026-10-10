import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { validateLicense, recordInstallationCheckIn } from '../../../../../lib/core/licenses';
import { getGithubProfile } from '../../../../../lib/core/settings';

function requestIp(request: Request) {
  return request.headers.get('x-real-ip')?.trim() || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
}

function telemetry(body: any) {
  const source = body?.telemetry && typeof body.telemetry === 'object' ? body.telemetry : {};
  const allowed = ['hostname', 'platform', 'architecture', 'client', 'clientVersion', 'provider', 'region', 'components'];
  return Object.fromEntries(
    allowed
      .filter((key) => source[key] !== undefined && source[key] !== null && source[key] !== '')
      .map((key) => [key, source[key]]),
  );
}

/**
 * Public customer/runtime license validation endpoint.
 *
 * Authentication is the license key in the request body. This endpoint must
 * not require a License Master integration token because every OrbitFS
 * installation is an independent client of the central authority.
 *
 * Administrative, issuance, release, and control endpoints remain protected
 * by the License Master integration/admin authentication layer.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const key = String(body?.license_key ?? body?.licenseKey ?? '').trim();
  const product = String(body?.product ?? body?.product_code ?? '').trim().toLowerCase();
  const installationId = String(body?.installation_id ?? body?.installationId ?? '').trim();
  const component = String(body?.component ?? body?.component_code ?? product).trim().toLowerCase();
  const action = String(body?.action ?? 'validate').trim().toLowerCase();

  if (!['validate','activate','check_in'].includes(action)) {
    return NextResponse.json({valid:false,code:'INVALID_ACTION'},{status:400});
  }
  if (key.length>256 || product.length>80 || component.length>80 || installationId.length>256) {
    return NextResponse.json({valid:false,code:'INVALID_REQUEST'},{status:400});
  }
  if (!key || !product) {
    return NextResponse.json({ valid: false, code: 'INVALID_REQUEST' }, { status: 400 });
  }

  try {
    const result = await validateLicense({
      key,
      productSlug: product,
      componentSlug: component || product,
      installationId: installationId || undefined,
      productVersion:
        body?.product_version ?? body?.productVersion
          ? String(body?.product_version ?? body?.productVersion)
          : undefined,
      metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
      requestIp: requestIp(request),
      userAgent: request.headers.get('user-agent'),
      telemetry: telemetry(body),
      action,
    });

    if (result.valid && String(body?.action || 'validate').toLowerCase() === 'check_in') {
      if (!result.license_id || !installationId) {
        return NextResponse.json({ valid: false, code: 'INSTALLATION_ID_REQUIRED' }, { status: 400 });
      }

      const suppliedReleaseId = String(body?.release_id ?? body?.releaseId ?? '').trim();
      const profile=await getGithubProfile();
      const engineRepo=profile==='fallback'?'remipetrovich-design/OrbitFS_Engine':'remipetrovich-design/OrbitFS_Engine';
      const branchPrefix = 'github:' + engineRepo + '@';
      const engineBranchReleaseId = suppliedReleaseId.startsWith(branchPrefix) && /^[a-f0-9]{40}$/i.test(suppliedReleaseId.slice(branchPrefix.length)) ? suppliedReleaseId : null;
      if (suppliedReleaseId && !engineBranchReleaseId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(suppliedReleaseId)) {
        return NextResponse.json({ valid: false, code: 'INVALID_RELEASE_ID' }, { status: 400 });
      }

      await recordInstallationCheckIn({
        licenseId: String(result.license_id),
        installationId,
        action:
          ['deploy', 'base_update', 'update', 'redeploy', 'rollback', 'check_in'].includes(
            String(body?.deployment_action || body?.action_name || 'check_in').toLowerCase(),
          )
            ? (String(body?.deployment_action || body?.action_name || 'check_in').toLowerCase() as any)
            : 'check_in',
        phase:
          ['started', 'completed', 'failed'].includes(String(body?.phase || 'completed').toLowerCase())
            ? (String(body?.phase || 'completed').toLowerCase() as any)
            : 'completed',
        product,
        productVersion:
          body?.product_version ?? body?.productVersion
            ? String(body?.product_version ?? body?.productVersion)
            : null,
        previousVersion:
          body?.previous_version ?? body?.previousVersion
            ? String(body?.previous_version ?? body?.previousVersion)
            : null,
        releaseId: engineBranchReleaseId ? null : suppliedReleaseId || null,
        deploymentId:
          body?.deployment_id ?? body?.deploymentId
            ? String(body?.deployment_id ?? body?.deploymentId)
            : null,
        deploymentUrl:
          body?.deployment_url ?? body?.deploymentUrl
            ? String(body?.deployment_url ?? body?.deploymentUrl)
            : null,
        projectId:
          body?.project_id ?? body?.projectId
            ? String(body?.project_id ?? body?.projectId)
            : null,
        projectName:
          body?.project_name ?? body?.projectName
            ? String(body?.project_name ?? body?.projectName)
            : null,
        provider: body?.provider ? String(body.provider) : 'vercel',
        region: body?.region ? String(body.region) : null,
        platform: body?.platform ? String(body.platform) : 'vercel',
        architecture: body?.architecture ? String(body.architecture) : null,
        hostname: body?.hostname ? String(body.hostname) : null,
        client: body?.client ? String(body.client) : 'orbitfs-client',
        clientVersion:
          body?.client_version ?? body?.clientVersion
            ? String(body?.client_version ?? body?.clientVersion)
            : null,
        customerIdentity: body?.customer_identity ?? body?.customerIdentity ?? null,
        details: {
          ...(body?.details && typeof body.details === 'object' && !Array.isArray(body.details) ? body.details : {}),
          ...(engineBranchReleaseId ? { engineBranchReleaseId } : {}),
        },
      });
    }

    return NextResponse.json(
      {
        valid: result.valid,
        code: result.code,
        expires_at: result.expires_at ?? null,
        expiresAt: result.expires_at ?? null,
        metadata: result.metadata ?? {},
        components: (result as any).components ?? {},
        installation: (result as any).installation ?? null,
        license_id: result.license_id ?? null,
        runtime_policy: (result as any).runtime_policy ?? null,
        pulse_revision: (result as any).runtime_policy?.pulse_revision ?? null,
        pulse_at: (result as any).runtime_policy?.pulse_at ?? null,
        authority_reason: (result as any).authority_reason ?? (result as any).runtime_policy?.authority_reason ?? null,
        provider_outage: Boolean((result as any).provider_outage),
        grace_action: (result as any).grace_action ?? 'normal',
        failure_counter_action: (result as any).failure_counter_action ?? 'normal',
      },
      { status: result.status },
    );
  } catch (error: any) {
    const requestId = crypto.randomUUID();
    console.error('license validation failed', { requestId, error });
    return NextResponse.json({
      valid: false,
      code: 'SERVER_ERROR',
      request_id: requestId,
      authority_reason: 'provider_failure',
      provider_outage: true,
      grace_action: 'freeze',
      failure_counter_action: 'freeze',
    }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
