'use client';
import {useState} from 'react';
import {useFormStatus} from 'react-dom';

type GithubProfile='primary'|'fallback';
type Props={
 profile:GithubProfile;
 masterOffline:boolean;
 canManage:boolean;
 action:(formData:FormData)=>Promise<void>;
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

export default function GithubProfileControl({profile,masterOffline,canManage,action}:Props){
 const [acknowledged,setAcknowledged]=useState(false);
 const target:GithubProfile=profile==='primary'?'fallback':'primary';
 const activeLabel=profile==='primary'?'MAIN':'FALLBACK';
 const targetLabel=target==='primary'?'MAIN':'FALLBACK';
 const canSwitch=canManage&&masterOffline&&acknowledged;

 return <section className="github-mode-panel" aria-label="Main and fallback source mode">
   <span className="authority-hardware-screw screw-tl" aria-hidden="true"/>
   <span className="authority-hardware-screw screw-tr" aria-hidden="true"/>
   <span className="authority-hardware-screw screw-bl" aria-hidden="true"/>
   <span className="authority-hardware-screw screw-br" aria-hidden="true"/>
   <div className="github-mode-inner">
    <div className="github-mode-heading"><div>
      <span>ORBITFS SOURCE AUTHORITY</span><h2>MAIN / FALLBACK</h2>
      <p>License Manager selects the active GitHub and Vercel account family. This switch does not modify your shared database or start a deployment.</p>
    </div><div className={`github-mode-status ${masterOffline?'ready':'blocked'}`}>
      <strong>{masterOffline?'MASTER OFF':'SWITCH LOCKED'}</strong>
      <small>{masterOffline?'Tick the checkbox to unlock the lever':'Turn Master Authority OFF first'}</small>
    </div></div>
    <form action={action}>
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
     {canManage&&<label className="github-mode-confirm-check">
       <input type="checkbox" name="acknowledged" checked={acknowledged} disabled={!masterOffline}
         onChange={event=>setAcknowledged(event.target.checked)} required/>
       <span><strong>I understand this switches production source authority to {targetLabel}.</strong>
        <small>Master Authority must be OFF. GitHub repositories and deployment workflows are checked before switching.
        Both Vercel accounts keep their own projects; this action does not deploy or migrate a database.</small>
       </span>
     </label>}
     <div className="github-mode-footer">
      <strong>ACTIVE: {activeLabel}</strong>
      <span>{masterOffline?(acknowledged?`Lever ready → ${targetLabel}`:'Tick the checkbox, then move the lever'):'Master Authority is ON — switching disabled'}</span>
     </div>
    </form>
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
