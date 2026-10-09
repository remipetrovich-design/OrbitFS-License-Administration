import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync('lib/core/source-activation.ts','utf8');
const settings=readFileSync('lib/core/settings.ts','utf8');
const ui=readFileSync('app/settings/page.tsx','utf8');
const control=readFileSync('app/components/GithubProfileControl.tsx','utf8');

test('exact three services per account, with distinct project IDs',()=>{
 for(const repo of ['lucaskerim123/Custom-licence-manager','lucaskerim123/Dev-panel','lucaskerim123/V2_Billing_Store',
  'remipetrovich-design/OrbitFS-License-Administration','remipetrovich-design/OrbitFS-Control-Centre','remipetrovich-design/OrbitFS-Billing-Shopfront'])
  assert.ok(source.includes(repo),repo);
 assert.match(source,/environments\/production/);
 assert.match(source,/secrets\/VERCEL_TOKEN/);
});
test('github action secret is sealed and only server-side, never plaintext in Git',()=>{
 assert.match(source,/crypto_box_seal/);
 assert.match(source,/secrets\/public-key/);
 assert.match(source,/key_id:key.key_id/);
 assert.match(source,/encrypted_value:sealed/);
 assert.doesNotMatch(source,/git\/contents.*VERCEL_TOKEN/);
 assert.doesNotMatch(source,/console\.log\([^)]*(?:github|vercel|token)/i);
});
test('switch synchronizes credential before commit, dispatches only after mode update',()=>{
 const method=settings.slice(settings.indexOf('export async function setGithubProfile('),settings.indexOf('export async function updateRuntimePolicy('));
 const iCredential=method.indexOf('syncSourceGitHubCredentials(next)');
 const iCommit=method.indexOf("await client.query('commit')");
 const iDispatch=method.indexOf('dispatchSourceProductionDeployments(next)');
 assert.ok(iCredential>0&&iCredential<iCommit&&iCommit<iDispatch);
 assert.match(method,/Master Authority must be OFF/);
 assert.match(method,/database_changes:false/);
});
test('owner-only self-heal and truthful incomplete routing status',()=>{
 assert.match(ui,/user\.role!=='owner'/);
 assert.match(ui,/reconcileCurrentSourceServiceDeployments/);
 assert.match(ui,/reconcileAction=\{autoRepairSourceServices\}/);
 assert.match(control,/Production service activation:/);
 assert.match(control,/The mode setting alone does not move public domains/);
});
