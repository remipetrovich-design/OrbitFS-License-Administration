'use client';
import {useActionState,useEffect,useState} from 'react';
import {useFormStatus} from 'react-dom';

type GithubProfile='primary'|'fallback';
export type SourceSwitchResult={status:'idle'|'error'|'success';message:string};
type Props={
 profile:GithubProfile;
 masterOffline:boolean;
 canManage:boolean;
 action:(previous:SourceSwitchResult,formData:FormData)=>Promise<SourceSwitchResult>;
 reconcileAction:()=>Promise<{status:'ready'|'queued'|'pending'|'error';message:string}>;
 prepareFallbackAction:()=>Promise<{status:'success'|'error';message:string}>;
 missingRequirements?:string[];
};

const mappings={
 primary:[
  ['Base','lucaskerim123/V1-vercel-base'],
  ['Engine','lucaskerim123/V1-vercel-engine'],
  ['Control Centre','lucaskerim123/Dev-panel'],
  ['License Manager','lucaskerim123/Custom-licence-manager'],
  ['Billing Store','lucaskerim123/V2_Billing_Store'],
 ],
 fallback:[
  ['Base','remipetrovich-design/OrbitFS-Base-System'],
  ['Engine','remipetrovich-design/OrbitFS_Engine'],
  ['Control Centre','remipetrovich-design/OrbitFS-Control-Centre'],
  ['License Manager','remipetrovich-design/OrbitFS-License-Administration'],
  ['Billing Store','remipetrovich-design/OrbitFS-Billing-Shopfront'],
 ],
} as const;

function ModeLever({profile,enabled,targetLabel}:{profile:GithubProfile;enabled:boolean;targetLabel:string}){
 const {pending}=useFormStatus();
 return <button type="submit"
   className={`github-mode-lever ${profile==='fallback'?'points-down':'points-up'}`}
   disabled={!enabled||pending}
   aria-label={pending?'Switching source mode…':enabled?`Switch source mode to ${targetLabel}`:'Turn Master Authority OFF and tick the acknowledgment checkbox'}
   aria-disabled={!enabled||pending}
   title={!enabled?'Master Authority must be OFF and the checkbox ticked before switching':`Switch to ${targetLabel}`}
  ><span className="github-mode-lever-slot"/><span className="github-mode-lever-stick"/><span className="github-mode-lever-cap"/></button>;
}

export default function GithubProfileControl({profile,masterOffline,canManage,action,reconcileAction,prepareFallbackAction,missingRequirements=[]}:Props){
 const [serviceStatus,setServiceStatus]=useState<{status:string;message:string}|null>(null);
 useEffect(()=>{
  if(!canManage)return;
  let canceled=false;
  void reconcileAction().then(result=>{if(!canceled)setServiceStatus(result)}).catch(()=>{
   if(!canceled)setServiceStatus({status:'error',message:'Could not check service deployments.'});
  });
  return ()=>{canceled=true};
 },[canManage,profile,reconcileAction]);
 const [acknowledged,setAcknowledged]=useState(false);
 const [preparing,setPreparing]=useState(false);
 const [prepareResult,setPrepareResult]=useState<{status:'success'|'error';message:string}|null>(null);
 const prepareStandby=()=>{
  setPreparing(true);
  setPrepareResult(null);
  void prepareFallbackAction().then(result=>setPrepareResult(result)).catch(()=>setPrepareResult({status:'error',message:'Fallback preparation request failed. No source switch was performed.'})).finally(()=>setPreparing(false));
 };
 const [result,formAction,isPending]=useActionState<SourceSwitchResult,FormData>(action,{status:'idle',message:''});
 const target:GithubProfile=profile==='primary'?'fallback':'primary';
 const activeLabel=profile==='primary'?'MAIN':'FALLBACK';
 const targetLabel=target==='primary'?'MAIN':'FALLBACK';
 const canSwitch=canManage&&masterOffline&&acknowledged&&!isPending&&missingRequirements.length===0;

 return <section className="github-mode-panel" aria-label="Main and fallback source mode">
   <span className="authority-hardware-screw screw-tl" aria-hidden="true"/>
   <span className="authority-hardware-screw screw-tr" aria-hidden="true"/>
   <span className="authority-hardware-screw screw-bl" aria-hidden="true"/>
   <span className="authority-hardware-screw screw-br" aria-hidden="true"/>
   <div className="github-mode-inner">
    <div className="github-mode-heading"><div>
      <span>ORBITFS SOURCE AUTHORITY</span><h2>MAIN / FALLBACK</h2>
      <p>License Manager selects the active GitHub and Vercel account family. The switch keeps the shared database unchanged and automatically provisions GitHub/Vercel account credentials and queues the selected service deployments. Domain routing is checked separately.</p>
    </div><div className={`github-mode-status ${masterOffline?'ready':'blocked'}`}>
      <strong>{masterOffline?'MASTER OFF':'SWITCH LOCKED'}</strong>
      <small>{masterOffline?'Tick the checkbox to unlock the lever':'Turn Master Authority OFF first'}</small>
    </div></div>
    <form action={formAction}>
     <input type="hidden" name="profile" value={target}/>
     <input type="hidden" name="expected_profile" value={profile}/>
     <div className="github-mode-console">
       <div className={`github-mode-side ${profile==='primary'?'is-active':''}`}>
        <span className="github-mode-lamp is-green" aria-hidden="true"/><strong>MAIN</strong><small>lucaskerim123 · Main Vercel</small>
       </div>
       <ModeLever profile={profile} enabled={canSwitch} targetLabel={targetLabel}/>
       <div className={`github-mode-side ${profile==='fallback'?'is-active':''}`}>
        <span className="github-mode-lamp is-red" aria-hidden="true"/><strong>FALLBACK</strong><small>remipetrovich-design · Fallback Vercel</small>
       </div>
     </div>
     {serviceStatus&&<div role="status" style={{padding:'10px 12px',margin:'10px 0',border:'1px solid #e1a72e',borderRadius:8,fontSize:12}}>
       <strong>Production service activation: {serviceStatus.status.toUpperCase()}</strong>
       <p>{serviceStatus.message}</p>
       {serviceStatus.status!=='ready'&&<small>The mode setting alone does not move public domains. Only a verified, working deployment can receive production routing.</small>}
     </div>}
     {missingRequirements.length>0&&<div role="status" style={{padding:'12px 14px',margin:'12px 0',border:'1px solid #e1a72e',borderRadius:8,background:'rgba(245,158,11,.10)',fontSize:12}}>
       <strong>{targetLabel} switch is not ready: missing Production connections.</strong>
       <p>Add these to the <strong>MAIN License Manager → Vercel → Production</strong> environment, then redeploy License Manager:</p>
       <ul style={{paddingLeft:20,marginTop:6}}>{missingRequirements.map(key=><li key={key}><code>{key}</code></li>)}</ul>
       <p>These are server-side preflight credentials. They can use your existing account tokens; the two GitHub/Vercel families must remain separate.</p>
     </div>}
     {result.status==='error'&&<p role="alert" style={{padding:'12px 14px',margin:'12px 0',border:'1px solid #dc5555',borderRadius:8,background:'rgba(239,68,68,.12)',fontSize:12}}>
       <strong>Switch not completed.</strong> {result.message} The active mode was not changed by this failed request.
     </p>}
     {result.status==='success'&&<p role="status" style={{padding:'12px 14px',margin:'12px 0',border:'1px solid #3b9d72',borderRadius:8,fontSize:12}}>{result.message}</p>}
     {canManage&&<label className="github-mode-confirm-check">
       <input type="checkbox" name="acknowledged" checked={acknowledged} disabled={!masterOffline}
         onChange={event=>setAcknowledged(event.target.checked)} required/>
       <span><strong>I understand this switches production source authority to {targetLabel}.</strong>
        <small>Master Authority must be OFF. GitHub repositories and deployment workflows are checked before switching.
        Both Vercel accounts keep their own projects; this action requests the target deployments but never migrates a database.</small>
       </span>
     </label>}
     <div className="github-mode-footer">
      <strong>ACTIVE: {activeLabel}</strong>
      <span>{masterOffline?(acknowledged?`Lever ready → ${targetLabel}`:'Tick the checkbox, then move the lever'):'Master Authority is ON — switching disabled'}</span>
     </div>
    </form>
    {profile==='primary'&&canManage&&<div style={{padding:'12px 14px',margin:'12px 0',border:'1px solid #6b7280',borderRadius:8,fontSize:12}}>
      <strong>Prepare Fallback before switching</strong>
      <p>Uses existing Main License Manager credentials to update the <code>production</code> GitHub Actions <code>VERCEL_TOKEN</code> in the three Fallback service repositories.</p>
      <button type="button" onClick={prepareStandby} disabled={!masterOffline||preparing}
        style={{padding:'8px 12px',marginTop:8,borderRadius:7,border:'1px solid currentColor',fontWeight:600}}>
        {preparing?'Preparing Fallback…':'Prepare Fallback GitHub connections'}
      </button>
      <p style={{marginTop:6}}>Requires Master Authority OFF. Does not switch modes, deploy applications, or change the shared database.</p>
      {prepareResult&&<p role={prepareResult.status==='error'?'alert':'status'} style={{marginTop:8,fontWeight:600}}>
        {prepareResult.status==='success'?'Prepared: ':'Not prepared: '}{prepareResult.message}
      </p>}
    </div>}
    <details className="mt-3">
     <summary style={{cursor:'pointer',fontSize:11}}>Show {targetLabel} GitHub source mapping</summary>
     <div className="github-mode-map">
      {mappings[target].map(([label,value])=><div key={label}><span>{label}</span><code>{value}</code></div>)}
      <div><span>Database source</span><code>lucaskerim123/Master-Database-System (shared)</code></div>
     </div>
    </details>
   </div>
 </section>;
}
