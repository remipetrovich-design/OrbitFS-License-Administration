/** Vercel account validation for MAIN / FALLBACK source selection.
 * Both sets of projects remain deployed to their own Vercel accounts.
 * A switch only selects which already-configured release workflows are active.
 */
export type SourceFamily='primary'|'fallback';
type VercelProject = {id:string;name:string;accountId:string};
type Destination={id:string;name:string};
const PROJECTS:Record<SourceFamily,{teamId:string;projects:Destination[];tokenEnv:string}>={
 primary:{teamId:'team_W3fS0X03YCjNkD2BoqRj6Uld',tokenEnv:'ORBITFS_MAIN_VERCEL_TOKEN',projects:[
   {id:'prj_rxRaSrRX2xwnmJ21zfjYL31RkLsv',name:'custom-licence-manager'},
   {id:'prj_o5ju4zFGSDZelX4SA7GAu3rQqtap',name:'base-deploy-panel'},
   {id:'prj_3ARdg4cRikU2OiMeZjZDvQ3JuEZd',name:'v2-billing-store'}
 ]},
 fallback:{teamId:'team_0fWVaLb24pyeeCRqqYu5G47K',tokenEnv:'ORBITFS_FALLBACK_VERCEL_TOKEN',projects:[
   {id:'prj_rCooJWY8JMkBjekXLO8scT35UPJ8',name:'orbitfs-license-fallback'},
   {id:'prj_24FvbyWw7CAEbiug1Ec18p51z7WJ',name:'orbitfs-dev-panel-fallback'},
   {id:'prj_BZNKPOm5pTcMdD4QrOXPOqpE7Imq',name:'orbitfs-billing-fallback'}
 ]}
};
export function configuredVercelFamily(profile:SourceFamily){return PROJECTS[profile];}
export async function verifyVercelAccountProjects(profile:SourceFamily){
 const target=PROJECTS[profile];
 const token=String(process.env[target.tokenEnv]||'').trim();
 if(!token||/^(change-me|replace-with|your-|placeholder)/i.test(token))
   throw new Error('Add '+target.tokenEnv+' to the Main License Manager Vercel Production environment through Vault before switching.');
 const verified:Array<{id:string;name:string;teamId:string}>=[];
 for(const project of target.projects){
   let response:Response;
   try {
     response=await fetch('https://api.vercel.com/v9/projects/'+encodeURIComponent(project.id)+'?teamId='+encodeURIComponent(target.teamId),{
       headers:{authorization:'Bearer '+token,accept:'application/json'},
       cache:'no-store',signal:AbortSignal.timeout(10000)
     });
   }catch{
     throw new Error('Vercel '+profile+' preflight timed out for '+project.name+'. No source mode changed.');
   }
   if(!response.ok)
     throw new Error('Vercel '+profile+' project verification failed: '+project.name+' (HTTP '+response.status+'). Confirm token access and account.');
   let actual:VercelProject;
   try{actual=await response.json() as VercelProject;}catch{throw new Error('Vercel returned unreadable project metadata. No source mode changed.');}
   if(actual.id!==project.id||actual.accountId!==target.teamId||actual.name!==project.name)
     throw new Error('Vercel project/team mismatch for '+project.name+'. No source mode changed.');
   verified.push({id:actual.id,name:actual.name,teamId:target.teamId});
 }
 return verified;
}
