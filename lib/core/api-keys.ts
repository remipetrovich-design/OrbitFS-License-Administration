import crypto from 'node:crypto';
import { db } from '../db';

export type ApiScope = 'license.issue' | 'license.validate' | 'license.manage' | 'releases.read' | 'releases.write' | 'releases.control' | 'deployment.read' | 'deployment.write';

function hashKey(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function generateApiKey() {
  return `lm_${crypto.randomBytes(32).toString('base64url')}`;
}

export async function createApiKey(input: { name: string; scopes: ApiScope[]; actorUserId: string }) {
  const key = generateApiKey();
  const scopes = Array.from(new Set(input.scopes));
  const result = await db().query(`insert into api_keys(name,key_hash,key_last4,scopes,created_by) values($1,$2,$3,$4,$5) returning id,name,key_last4,scopes,status,created_at`, [input.name.trim(), hashKey(key), key.slice(-4), JSON.stringify(scopes), input.actorUserId]);
  return { ...result.rows[0], key };
}

function scopeAllows(granted: ApiScope[], required: ApiScope) {
  if (granted.includes(required)) return true;
  if (granted.includes('license.manage') && ['license.issue', 'license.validate'].includes(required)) return true;
  if (granted.includes('license.validate') && required === 'license.issue') return true;
  if (granted.includes('releases.control') && ['releases.write', 'releases.read'].includes(required)) return true;
  if (granted.includes('releases.write') && required === 'releases.read') return true;
  if (granted.includes('deployment.write') && required === 'deployment.read') return true;
  return false;
}

function parseScopes(value: unknown): ApiScope[] {
  if (Array.isArray(value)) return value.filter((x): x is ApiScope => typeof x === 'string') as ApiScope[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((x): x is ApiScope => typeof x === 'string') as ApiScope[];
    } catch {}
    return value.split(',').map(x => x.trim()).filter(Boolean) as ApiScope[];
  }
  return [];
}

function envMachineKey(key: string) {
  const candidates = [
    process.env.BILLING_API_TOKEN,
    process.env.DEPLOYER_API_TOKEN,
    process.env.MASTER_API_TOKEN,
    process.env.INTEGRATION_API_TOKEN,
  ].filter(Boolean) as string[];
  return candidates.some(candidate => candidate.trim() === key);
}

export async function authenticateApiKey(request: Request, requiredScope?: ApiScope) {
  const authorization = request.headers.get('authorization') || '';
  const apiHeader = request.headers.get('x-api-key') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const key = (match?.[1] || apiHeader).trim();
  if (!key) return null;
  const result = await db().query(`select id,name,scopes,status from api_keys where key_hash=$1 limit 1`, [hashKey(key)]);
  const client = result.rows[0];
  if (client) {
    if (client.status !== 'active') return null;
    const scopes = parseScopes(client.scopes);
    if (requiredScope && !scopeAllows(scopes, requiredScope)) return null;
    await db().query(`update api_keys set last_used_at=now() where id=$1`, [client.id]);
    return { ...client, scopes };
  }
  if (envMachineKey(key)) {
    const controlToken = [process.env.BILLING_API_TOKEN, process.env.MASTER_API_TOKEN, process.env.INTEGRATION_API_TOKEN].filter(Boolean).some(candidate => candidate?.trim() === key);
    const scopes: ApiScope[] = ['license.issue', 'license.validate', 'license.manage', 'releases.read', 'releases.write', ...(controlToken ? ['releases.control' as ApiScope] : []), 'deployment.read', 'deployment.write'];
    if (requiredScope && !scopeAllows(scopes, requiredScope)) return null;
    return { name: controlToken ? 'control-machine-token' : 'environment-machine-token', scopes };
  }
  return null;
}

export async function revokeApiKey(id: string, actorUserId: string) {
  const result = await db().query(`update api_keys set status='revoked',revoked_at=now(),revoked_by=$2 where id=$1 and status='active' returning id`, [id, actorUserId]);
  return Boolean(result.rowCount);
}

export async function listApiKeys() {
  return (await db().query(`select id,name,key_last4,scopes,status,created_at,last_used_at,revoked_at from api_keys order by created_at desc`)).rows;
}
