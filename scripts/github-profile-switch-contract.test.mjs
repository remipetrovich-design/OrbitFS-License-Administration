import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const settings=readFileSync('lib/core/settings.ts','utf8');
const page=readFileSync('app/settings/page.tsx','utf8');
const control=readFileSync('app/components/GithubProfileControl.tsx','utf8');

test('owner-only, Master Authority OFF, and checkbox required server side',()=>{
 assert.match(page,/user\.role!=='owner'/);
 assert.match(page,/formData\.get\('acknowledged'\)==='on'/);
 assert.match(settings,/if\(!acknowledged\)throw new Error/);
 assert.match(settings,/if\(Boolean\(current\?\.system_enabled\)\)throw new Error/);
 assert.match(settings,/if\(actual!==expected\)throw new Error/);
});
test('only one checkbox and direct lever, never typed phrase or modal',()=>{
 assert.match(control,/name="acknowledged"/);
 assert.match(control,/type="checkbox"/);
 assert.match(control,/type="submit"/);
 assert.doesNotMatch(control,/SWITCH TO MAIN|SWITCH TO FALLBACK|github-mode-modal-backdrop|confirmationPhrase|setConfirming/);
});
test('two explicit credential families, no cross-account fallback tokens',()=>{
 assert.match(settings,/\['ORBITFS_FALLBACK_GITHUB_TOKEN'\]/);
 assert.match(settings,/\['ORBITFS_PRIMARY_GITHUB_TOKEN','ORBITFS_RELEASE_DISPATCH_TOKEN'\]/);
 assert.match(settings,/verifyGithubProfileTarget\(next\)/);
 assert.match(settings,/verifyVercelWorkflowTargets\(next\)/);
 assert.doesNotMatch(settings,/setTimeout\(resolve|dispatchGithubProfileActivation/);
});
test('DB is the authority and switch does not run deployer, migrations or updates',()=>{
 assert.match(settings,/select github_profile from system_settings where id=true/);
 assert.match(settings,/database_changes:false,deployments_triggered:false/);
 assert.doesNotMatch(settings,/githubProfileCache/);
 const method=settings.slice(settings.indexOf('export async function setGithubProfile('),settings.indexOf('export async function updateRuntimePolicy('));
 for(const banned of ['spawn(', 'applyMigration(', 'dispatchGithubProfileActivation(', 'deployUpdate(', 'deployBase('])
  assert.doesNotMatch(method,new RegExp(banned.replace(/[()]/g,'\\$&')));
});
test('Vercel workflow mappings are account- and project-specific',()=>{
 for(const id of ['prj_rxRaSrRX2xwnmJ21zfjYL31RkLsv','prj_o5ju4zFGSDZelX4SA7GAu3rQqtap','prj_3ARdg4cRikU2OiMeZjZDvQ3JuEZd','prj_rCooJWY8JMkBjekXLO8scT35UPJ8','prj_24FvbyWw7CAEbiug1Ec18p51z7WJ','prj_BZNKPOm5pTcMdD4QrOXPOqpE7Imq'])
  assert.ok(settings.includes(id),id);
 assert.match(settings,/Source profile or production Vercel token check is missing/);
});

test('account switch verifies real Vercel projects before changing source authority',()=>{
 const verifier=readFileSync('lib/core/source-vercel.ts','utf8');
 assert.match(settings,/verifyVercelAccountProjects\(next\)/);
 assert.match(verifier,/ORBITFS_MAIN_VERCEL_TOKEN/);
 assert.match(verifier,/ORBITFS_FALLBACK_VERCEL_TOKEN/);
 assert.match(verifier,/actual\.accountId!==target\.teamId/);
 assert.match(verifier,/No source mode changed/);
 for(const id of ['prj_rxRaSrRX2xwnmJ21zfjYL31RkLsv','prj_rCooJWY8JMkBjekXLO8scT35UPJ8'])
   assert.ok(verifier.includes(id));
});
