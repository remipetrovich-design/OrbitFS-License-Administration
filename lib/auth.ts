import { getSessionUser } from './session';
import { authenticateApiKey, ApiScope } from './core/api-keys';

export function serviceAuthorized(request: Request, expected: string | undefined) {
  if (!expected) return false;
  return request.headers.get('authorization') === `Bearer ${expected}`;
}

export async function integrationAuthorized(request: Request, scope?: ApiScope) {
  const managed = await authenticateApiKey(request, scope);
  if (managed) return managed;
  return serviceAuthorized(request, process.env.INTEGRATION_API_TOKEN) ? { name: 'legacy-integration-token', scopes: ['*'] } : null;
}

export function adminAuthorized(request: Request) {
  return serviceAuthorized(request, process.env.ADMIN_API_TOKEN);
}

export async function localAdminAuthorized() {
  const user = await getSessionUser();
  return user && ['owner','admin','operator'].includes(user.role) ? user : null;
}
