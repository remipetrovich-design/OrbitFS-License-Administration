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
export async function resumeSourceServices(profile:SourceFamily, resumed:string[]=[]){
 const p=PROJECTS[profile];
 // Record each completed operation immediately so even a partial resume can
 // be restored if subsequent checks or project operations fail.
 for(const id of [p.license,p.billing,p.panel]){
  await change(profile,id,'unpause');
  resumed.push(id);
 }
 return resumed;
}
export async function restoreResumedSourceServices(profile:SourceFamily,resumed:readonly string[]){
 const errors:string[]=[];
 // Restore in reverse order; License Manager is shut down last.
 for(const id of [...resumed].reverse()){
  try{await change(profile,id,'pause');}
  catch(error){errors.push(id+': '+(error instanceof Error?error.message:String(error)));}
 }
 return errors;
}
export type PreviousSourcePauseResult={paused:string[];failed:string[]};
export async function pausePreviousSourceServices(
 profile:SourceFamily,
 assertSelectedAuthority:()=>Promise<void>,
 record:(projectId:string,state:'paused'|'failed',reason?:string)=>Promise<void>,
 previouslyPaused:readonly string[]=[]
):Promise<PreviousSourcePauseResult>{
 const p=PROJECTS[profile];
 const paused=[...previouslyPaused],failed:string[]=[];
 // Pause old Billing and Control Centre first. The old License Manager is last.
 for(const id of [p.billing,p.panel,p.license]){
  if(paused.includes(id))continue;
  let reason:string|undefined;
  try{await assertSelectedAuthority();await change(profile,id,'pause');}
  catch(error){reason=error instanceof Error?error.message:String(error);}
  if(reason){
   failed.push(id+': '+reason);
   await record(id,'failed',reason);
   break;
  }
  paused.push(id);
  // Persist each receipt before continuing, so retries can skip successes.
  await record(id,'paused');
 }
 return {paused,failed};
}
