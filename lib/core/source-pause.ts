import {configuredVercelFamily} from './source-vercel';
type SourceFamily='primary'|'fallback';
const PROJECTS:Record<SourceFamily,{license:string;billing:string;panel:string}>={
 primary:{license:'prj_rxRaSrRX2xwnmJ21zfjYL31RkLsv',billing:'prj_3ARdg4cRikU2OiMeZjZDvQ3JuEZd',panel:'prj_o5ju4zFGSDZelX4SA7GAu3rQqtap'},
 fallback:{license:'prj_rCooJWY8JMkBjekXLO8scT35UPJ8',billing:'prj_BZNKPOm5pTcMdD4QrOXPOqpE7Imq',panel:'prj_24FvbyWw7CAEbiug1Ec18p51z7WJ'},
};
async function change(profile:SourceFamily,projectId:string,action:'pause'|'unpause'){
 const family=configuredVercelFamily(profile);
 const token=String(process.env[family.tokenEnv]||'').trim();
 if(!token)throw new Error('Missing Vercel token for '+profile+' project '+projectId);
 const endpoint='https://api.vercel.com/v1/projects/'+projectId+'/'+action+'?teamId='+encodeURIComponent(family.teamId);
 const response=await fetch(endpoint,{method:'POST',cache:'no-store',
  signal:AbortSignal.timeout(20000),headers:{authorization:'Bearer '+token,accept:'application/json'}});
 if(!response.ok)throw new Error('Vercel '+action+' denied for '+profile+' project '+projectId+' (HTTP '+response.status+')');
}
export async function resumeSourceServices(profile:SourceFamily){
 const p=PROJECTS[profile];
 // License Manager must be online before its dependents.
 for(const id of [p.license,p.billing,p.panel])await change(profile,id,'unpause');
}
export async function pausePreviousSourceServices(profile:SourceFamily){
 const p=PROJECTS[profile];
 // The old License Manager is always the final project taken offline.
 for(const id of [p.billing,p.panel,p.license])await change(profile,id,'pause');
}
