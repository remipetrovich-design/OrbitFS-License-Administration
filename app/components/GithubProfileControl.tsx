'use client';
import {useState} from 'react';

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

export default function GithubProfileControl({profile,masterOffline,canManage,action}:Props){
 const [confirming,setConfirming]=useState(false);
 const [vercelReady,setVercelReady]=useState(false);
 const [confirmation,setConfirmation]=useState('');
 const target:GithubProfile=profile==='primary'?'fallback':'primary';
 const activeLabel=profile==='primary'?'MAIN':'FALLBACK';
 const targetLabel=target==='primary'?'MAIN':'FALLBACK';
 const confirmationPhrase=target==='primary'?'SWITCH TO MAIN':'SWITCH TO FALLBACK';
 const canSwitch=canManage&&masterOffline;

 return <>
  <section className="github-mode-panel" aria-label="Main and fallback source mode">
   <span className="authority-hardware-screw screw-tl" aria-hidden="true"/>
   <span className="authority-hardware-screw screw-tr" aria-hidden="true"/>
   <span className="authority-hardware-screw screw-bl" aria-hidden="true"/>
   <span className="authority-hardware-screw screw-br" aria-hidden="true"/>
   <div className="github-mode-inner">
    <div className="github-mode-heading">
     <div>
      <span>ORBITFS SOURCE AUTHORITY</span>
      <h2>MAIN / FALLBACK</h2>
      <p>License Manager is the central source-mode authority. The mode cannot change while Master Authority is online.</p>
     </div>
     <div className={`github-mode-status ${masterOffline?'ready':'blocked'}`}>
      <strong>{masterOffline?'SWITCH READY':'SWITCH LOCKED'}</strong>
      <small>{masterOffline?'Master Authority is OFF':'Turn Master Authority OFF first'}</small>
     </div>
    </div>

    <div className="github-mode-console">
     <div className={`github-mode-side ${profile==='primary'?'is-active':''}`}>
      <span className={`github-mode-lamp ${profile==='primary'?'is-green':'is-red'}`} aria-hidden="true"/>
      <strong>MAIN</strong>
      <small>lucaskerim123</small>
     </div>

     <button
      type="button"
      className={`github-mode-lever ${profile==='fallback'?'points-down':'points-up'}`}
      disabled={!canSwitch}
      onClick={()=>{setVercelReady(false);setConfirmation('');setConfirming(true)}}
      aria-label={canSwitch?`Switch source mode to ${targetLabel}`:'Source mode switch is locked until Master Authority is off'}
     >
      <span className="github-mode-lever-slot"/>
      <span className="github-mode-lever-stick"/>
      <span className="github-mode-lever-cap"/>
     </button>

     <div className={`github-mode-side ${profile==='fallback'?'is-active':''}`}>
      <span className={`github-mode-lamp ${profile==='fallback'?'is-green':'is-red'}`} aria-hidden="true"/>
      <strong>FALLBACK</strong>
      <small>remipetrovich-design</small>
     </div>
    </div>

    <div className="github-mode-footer">
     <strong>ACTIVE: {activeLabel}</strong>
     <span>Change Vercel Git connections and sync the latest target source before moving this switch.</span>
    </div>
   </div>
  </section>

  {confirming&&<div className="github-mode-modal-backdrop" role="presentation" onMouseDown={()=>setConfirming(false)}>
   <div className="github-mode-modal" role="dialog" aria-modal="true" aria-labelledby="github-mode-confirm-title" onMouseDown={event=>event.stopPropagation()}>
    <div className="github-mode-modal-head">
     <span>SOURCE MODE CHANGE</span>
     <h3 id="github-mode-confirm-title">Switch {activeLabel} → {targetLabel}</h3>
    </div>
    <div className="github-mode-warning">
     <strong>Before switching:</strong>
     <p>Change the affected Vercel projects to the {targetLabel} Git repositories below and sync the latest source. Do not continue while any project is still connected to the old source family.</p>
    </div>
    <div className="github-mode-map">
     {mappings[target].map(([label,value])=><div key={label}><span>{label}</span><code>{value}</code></div>)}
    </div>
    <form action={action}>
     <input type="hidden" name="profile" value={target}/>
     <input type="hidden" name="expected_profile" value={profile}/>
     <label className="github-mode-confirm-check">
      <input type="checkbox" name="vercel_confirmed" checked={vercelReady} onChange={event=>setVercelReady(event.target.checked)} required/>
      <span><strong>I changed the Vercel Git connections and synced the latest source.</strong><small>The API/control plane is already offline because Master Authority is OFF.</small></span>
     </label>
     <label className="github-mode-phrase">
      <span>Type <strong>{confirmationPhrase}</strong> to confirm</span>
      <input name="confirmation" value={confirmation} onChange={event=>setConfirmation(event.target.value)} autoComplete="off" spellCheck={false}/>
      <small>License Manager will also verify the target GitHub credential, all five repositories and their required refs before changing mode.</small>
     </label>
     <div className="github-mode-modal-actions">
      <button type="button" className="button secondary" onClick={()=>setConfirming(false)}>Cancel</button>
      <button type="submit" className="button danger" disabled={!vercelReady||confirmation!==confirmationPhrase}>Switch to {targetLabel}</button>
     </div>
    </form>
   </div>
  </div>}
 </>;
}
