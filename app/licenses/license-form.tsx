'use client';
import {useActionState,useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {licenseFormAction,rotateLicenseAction} from './actions';

const initial={ok:false,key:'',error:''};

function KeyReveal({title,keyValue,detail,onClose}:{title:string;keyValue:string;detail:string;onClose:()=>void}){
 if(typeof document==='undefined')return null;
 const copy=()=>void navigator.clipboard?.writeText(keyValue);
 return createPortal(
  <div className="key-reveal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
   <section className="key-reveal-dialog" role="dialog" aria-modal="true" aria-label={title}>
    <div className="key-reveal-head">
     <div><div className="eyebrow">One-time credential</div><h2>{title}</h2></div>
     <button type="button" className="key-reveal-close" onClick={onClose} aria-label="Close">×</button>
    </div>
    <p className="muted">{detail}</p>
    <div className="license-key key-reveal-value">{keyValue}</div>
    <div className="key-reveal-actions">
     <button type="button" className="button" onClick={copy}>Copy license key</button>
     <button type="button" className="button secondary" onClick={onClose}>Close</button>
    </div>
    <small className="muted">This plaintext key is not stored and will not be shown again after this dialog is closed.</small>
   </section>
  </div>,
  document.body
 );
}

export function RotateLicenseButton({licenseId}:{licenseId:string}){
 const[state,action,pending]=useActionState(rotateLicenseAction,initial);
 const[dismissed,setDismissed]=useState(false);
 useEffect(()=>{if(state.key)setDismissed(false)},[state.key]);
 return <>
  <form action={action}>
   <input type="hidden" name="id" value={licenseId}/>
   <input type="hidden" name="action" value="rotate"/>
   <button className="button secondary license-action-button" disabled={pending}>{pending?'Rotating…':'Rotate key'}</button>
  </form>
  {state.error&&<div className="notice dangerBox floating-notice">{state.error}</div>}
  {state.ok&&state.key&&!dismissed&&<KeyReveal title="New license key" keyValue={state.key} detail={`License ${licenseId} has been rotated. Copy the replacement key before closing this dialog.`} onClose={()=>setDismissed(true)}/>}
 </>;
}

export default function LicenseForm({products}:{products:{id:string,name:string}[]}){
 const[state,action,pending]=useActionState(licenseFormAction,initial);
 const[dismissed,setDismissed]=useState(false);
 const[editing,setEditing]=useState<any>(null);
 useEffect(()=>{if(state.key)setDismissed(false)},[state.key]);
 useEffect(()=>{
  const handler=(event:Event)=>{
   const detail=(event as CustomEvent).detail;
   if(!detail)return;
   setEditing(detail);
   requestAnimationFrame(()=>document.getElementById('license-authority-form')?.scrollIntoView({behavior:'smooth',block:'start'}));
  };
  window.addEventListener('orbitfs-license-edit',handler as EventListener);
  return ()=>window.removeEventListener('orbitfs-license-edit',handler as EventListener);
 },[]);
 const policy=editing?.metadata?.license_policy||{};
 const components=policy?.components||{};
 const expires=editing?.expires_at?new Date(editing.expires_at).toISOString().slice(0,16):'';
 const resetEdit=()=>setEditing(null);
 return <section id="license-authority-form" className="card form-card critical-form">
  <div className="section-head"><div><h2>{editing?'Edit license':'Issue license'}</h2><p className="muted">{editing?'Update this authority record and its component entitlements.':'Create a license directly in the authority. The plaintext key is returned once.'}</p></div><span className="badge">MASTER</span></div>
  <form key={editing?.id||'issue'} className="form form-grid-2" action={action}>
   {editing&&<input type="hidden" name="id" value={editing.id}/>} 
   <label>Product<select className="input" name="product_id" required={!editing} defaultValue={editing?.product_id||''} disabled={Boolean(editing)}><option value="">Select product</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   <label>Customer external ID<input className="input" name="customer" defaultValue={editing?.customer_external_id||''} placeholder="CUST-000001 or ADMIN"/><small className="muted">Use the Billing Store customer number for normal customer licenses.</small></label>
   <label>External reference<input className="input" name="reference" defaultValue={editing?.external_reference||''} placeholder="Order / subscription reference"/></label>
   <label>Expiry<input className="input" name="expires" type="datetime-local" defaultValue={expires}/></label>
   <label>Installation limit<input className="input" value="1 active system" readOnly/><small className="muted">OrbitFS licences are permanently limited to one bound system at a time. Base and add-ons share this one system.</small></label>
   {!editing&&<label className="toggle"><input type="checkbox" name="customer_override"/><span><b>Allow an additional current licence for this customer</b><small>Admin override only. This creates a separate Base licence set instead of reusing the customer&apos;s existing current licence.</small></span></label>}
   <fieldset className="component-editor"><legend>Component entitlements</legend>
    <label><input type="checkbox" checked readOnly/> OrbitFS Base</label>
    <label><input type="checkbox" name="orbitfs_apex" defaultChecked={Boolean(components.orbitfs_apex)}/> OrbitFS APEX</label>
    <label><input type="checkbox" name="orbitfs_mcp" defaultChecked={Boolean(components.orbitfs_mcp)}/> OrbitFS MCP</label>
    <label><input type="checkbox" name="orbitfs_studio" defaultChecked={Boolean(components.orbitfs_studio)}/> OrbitFS Studio</label>
   </fieldset>
   <div className="form-actions"><button className="button" disabled={pending}>{pending?(editing?'Saving…':'Issuing…'):(editing?'Save license':'Issue license')}</button>{editing&&<button type="button" className="button secondary" onClick={resetEdit}>Cancel edit</button>}</div>
  </form>
  {state.error&&<div className="notice dangerBox" style={{marginTop:12}}>{state.error}</div>}
  {state.ok&&state.key&&!dismissed&&<KeyReveal title="License issued" keyValue={state.key} detail="The license was created successfully. Copy the key now before closing this dialog." onClose={()=>setDismissed(true)}/>}
  {state.ok&&!state.key&&editing&&<div className="notice" style={{marginTop:12}}>License updated.</div>}
 </section>;
}
