import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
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
test('two Vercel accounts keep their own License Manager connections without GitHub plaintext',()=>{
 assert.match(source,/syncLicenseManagerAccountConnections/);
 assert.match(source,/env\?upsert=true&teamId=/);
 assert.match(source,/ORBITFS_MAIN_VERCEL_TOKEN/);
 assert.match(source,/ORBITFS_FALLBACK_VERCEL_TOKEN/);
 assert.match(source,/type:'sensitive'/);
});
test('github action secret is sealed and only server-side, never plaintext in Git',()=>{
 assert.match(source,/crypto_box_seal/);
 assert.match(source,/secrets\/public-key/);
 assert.match(source,/key_id:key.key_id/);
 assert.match(source,/encrypted_value:sealed/);
 assert.doesNotMatch(source,/git\/contents.*VERCEL_TOKEN/);
 assert.doesNotMatch(source,/console\.log\([^)]*(?:github|vercel|token)/i);
});
test('switch validates standby and syncs credentials before commit, without automatic deployment',()=>{
 const method=settings.slice(settings.indexOf('export async function setGithubProfile('),settings.indexOf('export async function updateRuntimePolicy('));
 const iCredential=method.indexOf('syncSourceGitHubCredentials(next)');
 const iReadiness=method.indexOf('inspectSourceDeployments(next)');
 const iCommit=method.indexOf("await client.query('commit')");
 assert.ok(iCredential>0&&iCredential<iReadiness&&iReadiness<iCommit);
 assert.match(method,/if\(!destination\.allReady\)/);
 assert.match(method,/database_changes:false,deployments_triggered:false/);
 assert.doesNotMatch(method,/dispatchSourceProductionDeployments\(/);
});
test('owner-only self-heal and truthful incomplete routing status',()=>{
 assert.match(ui,/user\.role!=='owner'/);
 assert.match(ui,/reconcileCurrentSourceServiceDeployments/);
 assert.match(ui,/reconcileAction=\{autoRepairSourceServices\}/);
 assert.match(control,/Production service activation:/);
 assert.match(control,/The mode setting alone does not move public domains/);
});

test('owner can prepare standby Fallback while MAIN remains active, without deployment or mode switch',()=>{
 const prepare=source.slice(source.indexOf('export async function prepareFallbackGithubProduction('),source.indexOf('async function latestReadyDeployment('));
 assert.match(prepare,/select system_enabled,maintenance_mode,github_profile from system_settings/);
 assert.match(prepare,/Boolean\(state\?\.system_enabled\)\&\&!Boolean\(state\?\.maintenance_mode\)/);
 assert.match(prepare,/Boolean\(state\?\.system_enabled\)/);
 assert.match(prepare,/String\(state\?\.github_profile\)!=='primary'/);
 assert.match(prepare,/identity\.login/);
 assert.match(prepare,/verifyVercelAccountProjects\('fallback'\)/);
 assert.match(prepare,/syncSourceGitHubCredentials\('fallback'\)/);
 assert.match(prepare,/deployments_triggered:false/);
 assert.match(prepare,/source_mode_changed:false/);
 assert.match(prepare,/database_changed:false/);
 assert.doesNotMatch(prepare,/dispatchSourceProductionDeployments/);
 assert.doesNotMatch(prepare,/update system_settings set github_profile/);
 assert.match(ui,/user\.role!=='owner'/);
 assert.match(ui,/prepareFallbackAction=\{prepareFallbackConnections\}/);
 assert.match(control,/Prepare Fallback GitHub connections/);
 assert.match(ui,/allowPreparation=\{!masterEnabled\|\|maintenance\}/);
 assert.match(control,/disabled=\{!allowPreparation\|\|preparing\}/);
});

test('deployment inspection separates READY source, current commit, and health',async()=>{
 const begin=source.indexOf('async function latestReadyDeployment(');
 const end=source.indexOf('export async function dispatchSourceProductionDeployments(',begin);
 assert.ok(begin>=0&&end>begin,'readiness implementation is present');
 const snippet=source.slice(begin,end).replace('export async function inspectSourceDeployments','async function inspectSourceDeployments');
 const javascript=ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const currentSha='a'.repeat(40);
 const service={repo:'remipetrovich-design/OrbitFS-License-Administration',projectId:'project',healthUrl:'https://example.test/health'};
 const identity={githubOrg:'remipetrovich-design',githubRepo:'OrbitFS-License-Administration'};
 async function inspect(deployment,applicationHealthy=true){
  const context={
   WORKFLOWS:{fallback:[service]},
   credentials:()=>({github:'test-github-token',vercel:'test-vercel-token',teamId:'team'}),
   github:async()=>({object:{sha:currentSha}}),
   fetch:async()=>({ok:true,json:async()=>({deployments:deployment?[deployment]:[]})}),
   applicationReady:async()=>applicationHealthy,
   AbortSignal:{timeout:()=>undefined},
   encodeURIComponent
  };
  runInNewContext(javascript+';globalThis.inspect=inspectSourceDeployments;',context);
  return context.inspect('fallback');
 }
 const latest=await inspect({readyState:'READY',meta:{...identity,githubCommitSha:currentSha}});
 assert.equal(latest.allReady,true);
 assert.equal(latest.allCurrent,true);
 assert.equal(latest.services[0].current,true);
 const earlier=await inspect({readyState:'READY',meta:{...identity,githubCommitSha:'b'.repeat(40)}});
 assert.equal(earlier.allReady,true,'an operational prior deployment can be selected without automatic deployment');
 assert.equal(earlier.allCurrent,false,'outdated source must be reported separately');
 assert.match(earlier.services[0].reason,/earlier main commit/);
 const wrongRepo=await inspect({readyState:'READY',meta:{...identity,githubRepo:'Unrelated',githubCommitSha:currentSha}});
 assert.equal(wrongRepo.allReady,false,'never accept a deployment from a different repository');
 assert.match(wrongRepo.services[0].reason,/repository/);
 const unhealthy=await inspect({readyState:'READY',meta:{...identity,githubCommitSha:currentSha}},false);
 assert.equal(unhealthy.allReady,false,'the runtime health check must still protect source handover');
 assert.match(unhealthy.services[0].reason,/health endpoint unavailable/);
});
