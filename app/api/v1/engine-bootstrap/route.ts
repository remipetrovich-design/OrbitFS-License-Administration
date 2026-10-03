import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db';
import { validateLicense } from '../../../../lib/core/licenses';

// Private GitHub source is accessed exclusively by License Manager.
// Customer Base installations authenticate using their existing licence and installation ID.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const REPO = 'remipetrovich-design/OrbitFS_Engine';
const BRANCH = 'UPDATE_RELEASE';
const MAX_FILES = 5000;
const MAX_UNPACKED = 210 * 1024 * 1024;
const MAX_ARCHIVE = 75 * 1024 * 1024;
const COMPONENTS = ['mcp', 'apex', 'studio'];
const TOP_FILES = new Set(['.npmrc', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts']);
const MIGRATION = /^supabase\/migrations\/(shared|apex|mcp|studio)\/(\d{14}_[A-Za-z0-9._-]+)\.sql$/;

function reply(code: string, status: number) {
  return NextResponse.json({ ok: false, code }, { status, headers: { 'cache-control': 'no-store' } });
}
function sourceFile(path: string) {
  return TOP_FILES.has(path) || path.startsWith('src/') || path.startsWith('static/');
}
function safePath(path: string) {
  return path && !path.startsWith('/') && !path.includes('\\') &&
    !path.split('/').some((part) => !part || part === '.' || part === '..' || part === '.git' || part === 'node_modules' || part === '.vercel' || part === '.env' || part.startsWith('.env.'));
}
function componentFor(path: string) {
  for (const component of COMPONENTS) if (path.startsWith('src/addons/' + component + '/')) return component;
  return 'shared';
}
function githubToken() {
  return String(process.env.ORBITFS_RELEASE_DISPATCH_TOKEN || process.env.GITHUB_RELEASE_TOKEN || '').trim();
}
async function github(path: string) {
  const token = githubToken();
  if (!token) throw Object.assign(new Error('Private source credential missing'), { status: 503, code: 'ENGINE_SOURCE_CREDENTIAL_MISSING' });
  const response = await fetch('https://api.github.com/repos/' + REPO + path, {
    headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'OrbitFS-Custom-License-Manager' },
    cache: 'no-store', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw Object.assign(new Error('GitHub source request failed'), { status: 503, code: 'ENGINE_SOURCE_UNAVAILABLE' });
  return response.json();
}
async function authorized(request: Request) {
  const licenseKey = request.headers.get('x-license-key')?.trim() || '';
  const installationId = request.headers.get('x-installation-id')?.trim() || '';
  if (!licenseKey || !installationId) return { error: reply('ENGINE_INSTALLATION_CREDENTIAL_REQUIRED', 401) };
  const settings = (await db().query('select system_enabled,licensing_enabled,maintenance_mode,deployment_enabled,update_deployment_enabled from system_settings where id=true')).rows[0];
  if (!settings?.system_enabled || !settings?.licensing_enabled || settings?.maintenance_mode || !settings?.deployment_enabled || !settings?.update_deployment_enabled) {
    return { error: reply('ENGINE_DEPLOYMENT_AUTHORITY_UNAVAILABLE', 503) };
  }
  const validation: any = await validateLicense({ key: licenseKey, productSlug: 'orbitfs_base', componentSlug: 'orbitfs_base', installationId, action: 'validate', telemetry: { client: 'orbitfs-engine-source' } });
  if (!validation.valid || !validation.installation?.locked) return { error: reply(String(validation.code || 'ENGINE_LICENSE_DENIED'), validation.status || 403) };
  // Bootstrap supplies one full host snapshot; component activation still obeys each entitlement in Base.
  return { licenseId: validation.license_id, installationId };
}
async function wasPreviouslyAuthorized(installationId: string, licenseId: string, sha: string) {
  const result = await db().query(
    `select 1
       from audit_events
      where action='engine.source.authorized'
        and resource_type='installation'
        and details->>'installation_id'=$1
        and details->>'license_id'=$2
        and lower(details->>'source_commit')=$3
      limit 1`,
    [installationId, licenseId, sha],
  );
  return Number(result.rowCount || 0) > 0;
}
function manifestVersion(fetched: Array<{ path: string; bytes: Buffer }>, component: string, fallback: string) {
  const entry = fetched.find((item) => item.path === 'src/addons/' + component + '/manifest.ts');
  if (!entry) return fallback;
  const match = entry.bytes.toString('utf8').match(/\bversion\s*:\s*['"]([^'"]+)['"]/);
  return String(match?.[1] || fallback);
}
async function snapshot(pinned: string | null, allowHistorical = false) {
  const repository = await github('');
  if (String(repository.id) !== '1393749443' || String(repository.full_name).toLowerCase() !== REPO.toLowerCase())
    throw Object.assign(new Error('Engine repository identity mismatch'), { code: 'ENGINE_SOURCE_IDENTITY_MISMATCH', status: 502 });
  const ref = await github('/git/ref/heads/' + BRANCH);
  const latest = String(ref.object?.sha || '').toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(latest)) throw Object.assign(new Error('Invalid branch commit'), { code: 'ENGINE_SOURCE_SHA_INVALID', status: 502 });
  // Current branch head is always eligible. Historical commits are eligible only when
  // this same installation was previously authorized for that exact SHA.
  if (pinned && pinned !== latest && !allowHistorical) throw Object.assign(new Error('Branch moved since planning'), { code: 'ENGINE_SOURCE_STALE', status: 409 });
  const sha = pinned || latest;
  const tree = await github('/git/trees/' + sha + '?recursive=1');
  if (tree.truncated || !Array.isArray(tree.tree)) throw Object.assign(new Error('Incomplete source tree'), { code: 'ENGINE_SOURCE_TREE_INCOMPLETE', status: 502 });
  const invalidMigrations = tree.tree.filter((item: any) => item.type === 'blob' && /^supabase\/migrations\/(shared|apex|mcp|studio)\//.test(String(item.path || '')) && String(item.path).endsWith('.sql') && !MIGRATION.test(String(item.path)));
  if (invalidMigrations.length) throw Object.assign(new Error('Invalid migration path'), { code: 'ENGINE_SOURCE_MIGRATION_INVALID', status: 409 });
  const entries = tree.tree.filter((item: any) => item.type === 'blob' && (sourceFile(String(item.path || '')) || MIGRATION.test(String(item.path || '')))).sort((a: any, b: any) => String(a.path).localeCompare(String(b.path)));
  if (entries.length > MAX_FILES || !entries.length || !entries.some((item: any) => item.path === 'package.json') || !entries.some((item: any) => String(item.path).startsWith('src/')))
    throw Object.assign(new Error('Incomplete Engine source'), { code: 'ENGINE_SOURCE_FILES_INVALID', status: 502 });
  if (entries.some((item: any) => !safePath(String(item.path)) || !Number.isSafeInteger(Number(item.size)) || item.size < 0))
    throw Object.assign(new Error('Unsafe Engine source'), { code: 'ENGINE_SOURCE_PATH_INVALID', status: 502 });
  let total = 0;
  const fetched: any[] = new Array(entries.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, entries.length) }, async () => {
    while (next < entries.length) {
      const index = next++;
      const item = entries[index];
      const blob = await github('/git/blobs/' + encodeURIComponent(item.sha));
      if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw Object.assign(new Error('Invalid Git blob'), { code: 'ENGINE_SOURCE_BLOB_INVALID', status: 502 });
      const bytes = Buffer.from(blob.content.replace(/\s/g, ''), 'base64');
      if (bytes.length !== Number(item.size) || bytes.length > 2 * 1024 * 1024) throw Object.assign(new Error('Invalid source file size'), { code: 'ENGINE_SOURCE_FILE_SIZE_INVALID', status: 502 });
      total += bytes.length;
      if (total > MAX_UNPACKED) throw Object.assign(new Error('Engine source exceeds size limit'), { code: 'ENGINE_SOURCE_TOO_LARGE', status: 502 });
      fetched[index] = { path: String(item.path), bytes };
    }
  }));
  const migrations = fetched.filter((entry) => MIGRATION.test(entry.path)).map((entry) => {
    const match = entry.path.match(MIGRATION)!;
    return { id: match[1] + '.' + match[2], file: entry.path, component: match[1], encoding: 'base64', data: entry.bytes.toString('base64'), size: entry.bytes.length, sha256: createHash('sha256').update(entry.bytes).digest('hex') };
  }).sort((a, b) => a.file.split('/').pop()!.localeCompare(b.file.split('/').pop()!) || a.file.localeCompare(b.file));
  if (!migrations.length) throw Object.assign(new Error('No Engine baseline migrations'), { code: 'ENGINE_SOURCE_DATABASE_MISSING', status: 409 });
  const files = fetched.filter((entry) => sourceFile(entry.path)).map((entry) => ({
    file: entry.path, component: componentFor(entry.path), data: entry.bytes.toString('base64'), encoding: 'base64',
    size: entry.bytes.length, sha256: createHash('sha256').update(entry.bytes).digest('hex'),
  }));
  const packageJson = JSON.parse(fetched.find((entry) => entry.path === 'package.json')!.bytes.toString('utf8'));
  const version = String(packageJson.version || '0.0.0');
  const releaseId = 'github:' + REPO + '@' + sha;
  const componentVersions = Object.fromEntries(COMPONENTS.map((component) => [component, manifestVersion(fetched, component, version)]));
  const packageData = {
    format: 'orbitfs-engine-release-v3', schemaVersion: 3, version, releaseId, sourceCommit: sha,
    createdAt: '1970-01-01T00:00:00.000Z', components: COMPONENTS, componentVersions,
    checkpointRequired: true, minimumEngineDeployerProtocol: 1, minimumBaseVersion: '1.0.0', projectSettings: { framework: 'sveltekit', buildCommand: 'npm run build', installCommand: 'npm ci' },
    database: { format: 'orbitfs-db-migrations-v1', mode: 'shared-panel', provider: 'supabase', migrationCount: migrations.length, migrations },
    fileCount: files.length, files,
  };
  const archive = gzipSync(Buffer.from(JSON.stringify(packageData)), { level: 9 });
  if (archive.length > MAX_ARCHIVE) throw Object.assign(new Error('Engine archive exceeds size limit'), { code: 'ENGINE_ARCHIVE_TOO_LARGE', status: 502 });
  return { archive, sha, version, releaseId, fileCount: files.length, checksum: createHash('sha256').update(archive).digest('hex') };
}
export async function GET(request: Request) {
  try {
    const grant = await authorized(request);
    if (grant.error) return grant.error;
    const url = new URL(request.url);
    const pinned = url.searchParams.get('sha')?.toLowerCase() || null;
    if (pinned && !/^[a-f0-9]{40}$/.test(pinned)) return reply('ENGINE_SOURCE_SHA_INVALID', 400);
    const allowHistorical = pinned ? await wasPreviouslyAuthorized(String(grant.installationId), String(grant.licenseId), pinned) : false;
    const result = await snapshot(pinned, allowHistorical);
    await db().query(
      "insert into audit_events(actor,action,resource_type,details) values($1,'engine.source.authorized','installation',$2)",
      ['engine-bootstrap', JSON.stringify({ installation_id: grant.installationId, license_id: grant.licenseId, source_commit: result.sha, downloaded: url.searchParams.get('download') === '1' })],
    );
    if (url.searchParams.get('download') === '1')
      return new Response(new Uint8Array(result.archive), { headers: { 'content-type': 'application/gzip', 'cache-control': 'private, no-store', 'x-orbitfs-source-sha': result.sha, 'x-orbitfs-artifact-sha256': result.checksum } });
    return NextResponse.json({ ok: true, release: {
      id: result.releaseId, version: result.version, sourceCommit: result.sha, sourceRepo: REPO,
      sourceRef: BRANCH, checksum: result.checksum, fileCount: result.fileCount, components: COMPONENTS,
      minimumEngineDeployerProtocol: 1, minimumBaseVersion: '1.0.0', checkpointRequired: true,
    } }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error: any) {
    console.error('authorized engine bootstrap failed', { code: error?.code || 'ENGINE_SOURCE_ERROR' });
    return reply(String(error?.code || 'ENGINE_SOURCE_ERROR'), Number(error?.status || 503));
  }
}
