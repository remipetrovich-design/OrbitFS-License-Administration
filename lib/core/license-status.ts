export type CanonicalLicenseStatus='pending'|'active'|'locked'|'restricted'|'suspended'|'terminated'|'expired';

type CanonicalLicenseInput={
  storageStatus?:string|null;
  activationStatuses?:Array<string|null|undefined>|null;
  metadata?:Record<string,unknown>|null;
};

function enforcementScope(metadata:Record<string,unknown>|null|undefined){
  const raw=metadata&&typeof metadata==='object'?(metadata as any).license_enforcement:null;
  return raw&&typeof raw==='object'?String(raw.scope||'').trim().toLowerCase():'';
}

export function canonicalLicenseStatus(input:CanonicalLicenseInput):CanonicalLicenseStatus{
  const storage=String(input.storageStatus||'pending').trim().toLowerCase();
  if(storage==='revoked'||storage==='terminated')return 'terminated';
  if(storage==='expired')return 'expired';
  if(storage==='pending')return 'pending';
  if(storage==='suspended')return enforcementScope(input.metadata)==='account'?'suspended':'restricted';
  if(storage!=='active')return 'restricted';
  const locked=(input.activationStatuses||[]).some(status=>String(status||'').trim().toLowerCase()==='active');
  return locked?'locked':'active';
}

export function canonicalComponentStatus(input:{licenseStatus:CanonicalLicenseStatus;entitled:boolean}):CanonicalLicenseStatus|'not_entitled'{
  if(!input.entitled)return 'not_entitled';
  if(input.licenseStatus==='terminated'||input.licenseStatus==='expired'||input.licenseStatus==='pending'||input.licenseStatus==='suspended'||input.licenseStatus==='restricted')return input.licenseStatus;
  return input.licenseStatus;
}

export function canonicalStatusLabel(status:CanonicalLicenseStatus){
  return status.charAt(0).toUpperCase()+status.slice(1);
}

export function isCanonicalLicenseUsable(status:CanonicalLicenseStatus){
  return status==='active'||status==='locked';
}

export function isCanonicalLicenseBound(status:CanonicalLicenseStatus){
  return status==='locked';
}
