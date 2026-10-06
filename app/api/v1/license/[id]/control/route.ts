import { NextResponse } from 'next/server';
import { integrationAuthorized } from '../../../../../../lib/auth';
import { db } from '../../../../../../lib/db';
import { reactivateTerminatedLicense, rotateLicense, setInstallationStatus, setLicenseStatus, terminateLicense } from '../../../../../../lib/core/licenses';
import { sendPulse } from '../../../../../../lib/core/settings';
import { canonicalLicenseStatus } from '../../../../../../lib/core/license-status';

async function canonicalLicenseRecord(row:any){
  const activationStatuses=(await db().query('select status from activations where license_id=$1',[row.id])).rows.map((activation:any)=>String(activation.status||''));
  const status=canonicalLicenseStatus({storageStatus:row.status,metadata:row.metadata,activationStatuses});
  return {...row,storage_status:row.status,status,effective_status:status,canonical_status:status};
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await integrationAuthorized(request, 'license.manage');
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const action = String(body?.action || '').trim().toLowerCase();
  const installationId = String(body?.installation_id || body?.installationId || '').trim();

  if (!['rotate', 'unlock', 'customer-unlock', 'restrict', 'suspend', 'terminate', 'revoke', 'activate', 'set-component', 'set-components', 'lock-installation', 'unlock-installation', 'reactivate-installation', 'terminate-installation'].includes(action)) {
    return NextResponse.json({ error: 'Unsupported license control action' }, { status: 400 });
  }

  const current = (
    await db().query(
      `select l.id,l.status,l.expires_at,l.customer_external_id,l.customer_override,l.external_reference,l.metadata,
              p.id product_id,p.slug product
       from licenses l join products p on p.id=l.product_id
       where l.id=$1 limit 1`,
      [id],
    )
  ).rows[0];

  if (!current) return NextResponse.json({ error: 'License not found' }, { status: 404 });

  try {
    if (action === 'rotate') {
      const replacement = await rotateLicense(id, null, 'external-integration');
      return NextResponse.json({
        ok: true,
        action,
        license: replacement,
        previous_license_id: id,
        message: 'License rotated. The new key is returned once and is never stored in plaintext.',
      });
    }

    if (action === 'set-component') {
      if (current.product !== 'orbitfs_base') {
        return NextResponse.json({ error: 'Components can only be attached to an OrbitFS Base license' }, { status: 400 });
      }
      const component = String(body?.component || body?.component_key || body?.componentKey || '').trim().toLowerCase();
      const allowed = new Set(['orbitfs_apex', 'orbitfs_mcp', 'orbitfs_studio']);
      if (!allowed.has(component)) {
        return NextResponse.json({ error: 'Unsupported OrbitFS add-on component', code: 'COMPONENT_NOT_SUPPORTED' }, { status: 400 });
      }
      if (typeof body?.enabled !== 'boolean') {
        return NextResponse.json({ error: 'enabled must be true or false', code: 'COMPONENT_STATE_REQUIRED' }, { status: 400 });
      }
      const expired = Boolean(current.expires_at && new Date(current.expires_at).getTime() <= Date.now());
      if (body.enabled && (current.status !== 'active' || expired)) {
        return NextResponse.json({ error: 'Add-ons can only be activated while the Base licence is Active or Locked', code: expired ? 'LICENSE_EXPIRED' : 'LICENSE_NOT_ACTIVE' }, { status: 409 });
      }
      const existingPolicy = current.metadata && typeof current.metadata === 'object' && current.metadata.license_policy && typeof current.metadata.license_policy === 'object' ? current.metadata.license_policy : {};
      const existingComponents = existingPolicy.components && typeof existingPolicy.components === 'object' ? existingPolicy.components : {};
      const components: Record<string, boolean> = {
        orbitfs_base: true,
        orbitfs_apex: Boolean(existingComponents.orbitfs_apex),
        orbitfs_mcp: Boolean(existingComponents.orbitfs_mcp),
        orbitfs_studio: Boolean(existingComponents.orbitfs_studio),
      };
      components[component] = body.enabled;
      const metadata = { ...(current.metadata || {}), license_policy: { ...existingPolicy, components } };
      const updated = await canonicalLicenseRecord((await db().query('update licenses set metadata=$2 where id=$1 returning id,status,metadata', [id, JSON.stringify(metadata)])).rows[0]);
      await db().query(
        `insert into audit_events(actor,action,resource_type,resource_id,details) values($1,'license.component','license',$2,$3)`,
        [`api:${auth.name}`, id, JSON.stringify({ component, enabled: body.enabled, components, binding_preserved: true })],
      );
      const pulse = await sendPulse(null, `api:${auth.name}`, 'license-component-changed', { license_id: id, component, enabled: body.enabled, binding_preserved: true });
      return NextResponse.json({
        ok: true,
        action,
        license: updated,
        components,
        binding_preserved: true,
        pulse,
        message: body.enabled
          ? 'Add-on activated. The existing Base installation binding remains locked to its current installation.'
          : 'Add-on deactivated. The existing Base installation binding is unchanged.',
      });
    }

    if (action === 'set-components') {
      if (current.product !== 'orbitfs_base') {
        return NextResponse.json({ error: 'Components can only be attached to an OrbitFS Base license' }, { status: 400 });
      }
      const allowed = new Set(['orbitfs_base', 'orbitfs_apex', 'orbitfs_mcp', 'orbitfs_studio']);
      const supplied = body?.components && typeof body.components === 'object' ? body.components : {};
      const existingPolicy = current.metadata && typeof current.metadata === 'object' && current.metadata.license_policy && typeof current.metadata.license_policy === 'object' ? current.metadata.license_policy : {};
      const components: Record<string, boolean> = { orbitfs_base: true };
      for (const key of allowed) {
        if (key === 'orbitfs_base') continue;
        components[key] = Boolean(supplied[key]);
      }
      const metadata = { ...(current.metadata || {}), license_policy: { ...existingPolicy, components } };
      const updated = await canonicalLicenseRecord((await db().query('update licenses set metadata=$2 where id=$1 returning id,status,metadata', [id, JSON.stringify(metadata)])).rows[0]);
      await db().query(
        `insert into audit_events(actor,action,resource_type,resource_id,details) values($1,'license.components','license',$2,$3)`,
        [`api:${auth.name}`, id, JSON.stringify({ components })],
      );
      const pulse = await sendPulse(null, `api:${auth.name}`, 'license-components-changed', { license_id: id, components, binding_preserved: true });
      return NextResponse.json({ ok: true, action, license: updated, components, binding_preserved: true, pulse });
    }

    if (['unlock', 'customer-unlock', 'lock-installation', 'unlock-installation', 'reactivate-installation', 'terminate-installation'].includes(action)) {
      if (['lock-installation','reactivate-installation','terminate-installation'].includes(action)) {
        return NextResponse.json({ error: 'Locked means bound to an installation. Use restrict for admin enforcement or unlock-installation to release the binding.', code: 'LEGACY_INSTALLATION_CONTROL_REMOVED' }, { status: 409 });
      }
      if (!installationId) return NextResponse.json({ error: 'installation_id is required for installation control' }, { status: 400 });
      if (current.status !== 'active') return NextResponse.json({ error: 'Unlock is unavailable unless the licence is active', code: 'LICENSE_CONTROLS_LOCKED' }, { status: 409 });
      if (action === 'customer-unlock') {
        const settings = (await db().query('select system_enabled,licensing_enabled,maintenance_mode,customer_self_unlock_enabled from system_settings where id=true')).rows[0];
        const customerUnlockEffective=Boolean(settings?.system_enabled)&&Boolean(settings?.licensing_enabled)&&!Boolean(settings?.maintenance_mode)&&Boolean(settings?.customer_self_unlock_enabled);
        if (!customerUnlockEffective) return NextResponse.json({ error: 'Customer installation unlock is disabled by License Manager authority', code: 'CUSTOMER_INSTALLATION_UNLOCK_DISABLED' }, { status: 403 });
      }
      const activation = (await db().query('select id,status from activations where license_id=$1 and installation_id=$2 limit 1',[id,installationId])).rows[0];
      if (!activation) return NextResponse.json({ error: 'Installation not found for this license' }, { status: 404 });
      if (activation.status !== 'active') return NextResponse.json({ ok:true, action, installation:activation, message:'Licence is already active and unbound.' });
      const result = await setInstallationStatus(activation.id, 'released', null, 'external-integration');
      return NextResponse.json({ ok:true, action, installation:result, message:'Licence unlocked. It is active, unbound and ready to activate on one installation.' });
    }

    if (action === 'restrict') {
      const result = await setLicenseStatus(id, 'suspended', null, 'external-integration', {enforcementScope:'license',reason:String(body?.reason||'').trim()||null});
      return NextResponse.json({ ok:true, action, license:result, message:'Licence restricted. Its installation binding is preserved while runtime and controlled actions are denied.' });
    }
    if (action === 'suspend') {
      const scope=String(body?.scope||body?.enforcement_scope||'').trim().toLowerCase();
      if(scope!=='account')return NextResponse.json({error:'Suspend is reserved for global account enforcement. Use restrict for a single licence.',code:'ACCOUNT_SUSPENSION_SCOPE_REQUIRED'},{status:400});
      const result = await setLicenseStatus(id, 'suspended', null, 'external-integration', {enforcementScope:'account',reason:String(body?.reason||'').trim()||null});
      return NextResponse.json({ ok:true, action, license:result, message:'Licence suspended by global account enforcement. Existing installation binding is preserved.' });
    }
    if (action === 'terminate' || action === 'revoke') {
      const result = await terminateLicense(id, null, 'external-integration');
      return NextResponse.json({ ok:true, action, license:result, message:'Licence terminated. Its previous key is permanently invalid.' });
    }
    if (action === 'activate') {
      if (current.status === 'revoked') {
        const result = await reactivateTerminatedLicense(id, null, 'external-integration');
        return NextResponse.json({ ok:true, action, license:result, key:result.key, message:'Terminated licence manually reactivated with a new one-time key. Licence is active and unbound.' });
      }
      const result = await setLicenseStatus(id, 'active', null, 'external-integration');
      return NextResponse.json({ ok:true, action, license:result, message:result.status==='locked'?'Licence restored and remains Locked to its existing installation.':'Licence Active, unbound and ready to install.' });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'License control failed' },
      { status: 503 },
    );
  }
}
