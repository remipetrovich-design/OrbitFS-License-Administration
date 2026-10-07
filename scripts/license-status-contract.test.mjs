import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

function loadStatusModule(){
  const source=readFileSync(new URL('../lib/core/license-status.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}
  }).outputText;
  const moduleShim={exports:{}};
  const fn=new Function('exports','module','require',compiled);
  fn(moduleShim.exports,moduleShim,()=>{throw new Error('license-status.ts must stay dependency-free')});
  return moduleShim.exports;
}

const {canonicalLicenseStatus,canonicalComponentStatus}=loadStatusModule();

test('active means active and unbound',()=>{
  assert.equal(canonicalLicenseStatus({storageStatus:'active',activationStatuses:[]}), 'active');
});

test('an active licence with an active installation binding is locked',()=>{
  assert.equal(canonicalLicenseStatus({storageStatus:'active',activationStatuses:['released','active']}), 'locked');
});

test('global account enforcement is suspended',()=>{
  assert.equal(canonicalLicenseStatus({
    storageStatus:'suspended',
    activationStatuses:['active'],
    metadata:{license_enforcement:{scope:'account'}}
  }), 'suspended');
});

test('single licence admin enforcement is restricted',()=>{
  assert.equal(canonicalLicenseStatus({
    storageStatus:'suspended',
    activationStatuses:['active'],
    metadata:{license_enforcement:{scope:'license'}}
  }), 'restricted');
  assert.equal(canonicalLicenseStatus({storageStatus:'suspended',activationStatuses:['active']}), 'restricted');
});

test('legacy revoked is exposed canonically as terminated',()=>{
  assert.equal(canonicalLicenseStatus({storageStatus:'revoked',activationStatuses:['active']}), 'terminated');
});

test('pending and expired remain canonical terminal/pre-activation states',()=>{
  assert.equal(canonicalLicenseStatus({storageStatus:'pending'}), 'pending');
  assert.equal(canonicalLicenseStatus({storageStatus:'expired'}), 'expired');
});

test('component access follows the root licence while remaining independently restrictable',()=>{
  assert.equal(canonicalComponentStatus({licenseStatus:'locked',entitled:true}), 'locked');
  assert.equal(canonicalComponentStatus({licenseStatus:'locked',entitled:false}), 'not_entitled');
  assert.equal(canonicalComponentStatus({licenseStatus:'suspended',entitled:true}), 'suspended');
  assert.equal(canonicalComponentStatus({licenseStatus:'terminated',entitled:true}), 'terminated');
});
