'use client';
import {useFormStatus} from 'react-dom';

export type AuthorityControlRow={
  field:string;
  label:string;
  help:string;
  enabled:boolean;
  onText:string;
  offText:string;
  dangerWhen?:boolean;
};

type LockState={code:string;reason:string}|null;

const PRIMARY_FIELDS=[
  'licensing_enabled',
  'maintenance_mode',
  'customer_self_unlock_enabled',
  'release_system_enabled',
  'auto_technical_approval_enabled',
  'deployment_enabled',
] as const;

const DEPLOYMENT_FIELDS=[
  'base_deployment_enabled',
  'update_deployment_enabled',
  'rollback_enabled',
] as const;

function SwitchFace({effective,pending=false}:{effective:boolean;pending?:boolean}){
 return <>
  <span className={`authority-hardware-lamp ${effective?'is-green':'is-red'}`} aria-hidden="true"/>
  <span className="authority-hardware-switch-stage" aria-hidden="true">
   <span className="authority-hardware-switch-label is-off-label">OFF</span>
   <span className={`authority-hardware-toggle ${effective?'is-down':'is-up'}`}>
    <span className="authority-hardware-toggle-bezel"/>
    <span className="authority-hardware-toggle-stick"/>
   </span>
   <span className="authority-hardware-switch-label is-on-label">ON</span>
  </span>
  {pending&&<span className="authority-hardware-applying">APPLYING…</span>}
 </>;
}

function ManagedSwitch({row,effective,configured,lock}:{row:AuthorityControlRow;effective:boolean;configured:boolean;lock:LockState}){
 const {pending}=useFormStatus();
 const disabled=pending||Boolean(lock);
 const description=lock
  ? `${row.label} is disabled because ${lock.reason.toLowerCase()}. Configured state is ${configured?'on':'off'}.`
  : `${effective?'Disable':'Enable'} ${row.label}`;
 return <button
  type="submit"
  className={`authority-hardware-switch-button ${effective?'is-on':'is-off'} ${lock?'is-locked':''}`}
  disabled={disabled}
  aria-pressed={effective}
  aria-label={description}
  title={lock?`${lock.reason}. Configured ${configured?'ON':'OFF'}.`:row.help}
 >
  <SwitchFace effective={effective} pending={pending}/>
 </button>;
}

function ReadOnlySwitch({row,effective,configured,lock}:{row:AuthorityControlRow;effective:boolean;configured:boolean;lock:LockState}){
 const description=lock
  ? `${row.label} is disabled because ${lock.reason.toLowerCase()}. Configured state is ${configured?'on':'off'}.`
  : `${row.label} is ${effective?'on':'off'}.`;
 return <button
  type="button"
  className={`authority-hardware-switch-button ${effective?'is-on':'is-off'} ${lock?'is-locked':''}`}
  disabled
  aria-pressed={effective}
  aria-label={description}
  title={row.help}
 >
  <SwitchFace effective={effective}/>
 </button>;
}

function PanelCell({
 row,
 effective,
 configured,
 lock,
 canManage,
 action,
 master=false,
}:{
 row:AuthorityControlRow;
 effective:boolean;
 configured:boolean;
 lock:LockState;
 canManage:boolean;
 action:(formData:FormData)=>Promise<void>;
 master?:boolean;
}){
 return <article className={`authority-hardware-cell ${master?'is-master':''} ${effective?'is-effective-on':'is-effective-off'} ${lock?'is-locked':''}`}>
  <h3>{master?'MASTER AUTHORITY':row.label}</h3>
  {master&&<div className="authority-hardware-master-subtitle">{row.label}</div>}
  <div className="authority-hardware-control">
   {canManage?<form action={action} className="authority-hardware-form">
    <input type="hidden" name="field" value={row.field}/>
    <input type="hidden" name="value" value={configured?'false':'true'}/>
    <ManagedSwitch row={row} effective={effective} configured={configured} lock={lock}/>
   </form>:<ReadOnlySwitch row={row} effective={effective} configured={configured} lock={lock}/>}
  </div>
  {lock&&<div className="authority-hardware-lock"><strong>{lock.code}</strong><span>{lock.reason}</span><small>Configured {configured?'ON':'OFF'}</small></div>}
 </article>;
}

export default function AuthorityControlGrid({rows,canManage,action}:{rows:AuthorityControlRow[];canManage:boolean;action:(formData:FormData)=>Promise<void>}){
 const rowMap=new Map(rows.map(row=>[row.field,row]));
 const master=rowMap.get('system_enabled');
 if(!master)return null;

 const configured=Object.fromEntries(rows.map(row=>[row.field,Boolean(row.enabled)])) as Record<string,boolean>;
 const masterOn=Boolean(configured.system_enabled);
 const maintenanceOn=masterOn&&Boolean(configured.maintenance_mode);
 const deploymentOn=masterOn&&Boolean(configured.deployment_enabled);

 const effectiveFor=(field:string)=>{
  const value=Boolean(configured[field]);
  if(field==='system_enabled')return value;
  if(!masterOn)return false;
  if((field==='licensing_enabled'||field==='customer_self_unlock_enabled')&&maintenanceOn)return false;
  if(DEPLOYMENT_FIELDS.includes(field as (typeof DEPLOYMENT_FIELDS)[number])&&!deploymentOn)return false;
  return value;
 };

 const lockFor=(field:string):LockState=>{
  if(field==='system_enabled')return null;
  if(!masterOn)return {code:'MASTER OFF',reason:'Master authority is offline'};
  if((field==='licensing_enabled'||field==='customer_self_unlock_enabled')&&maintenanceOn){
   return {code:'MAINTENANCE',reason:'Maintenance enforcement is active'};
  }
  if(DEPLOYMENT_FIELDS.includes(field as (typeof DEPLOYMENT_FIELDS)[number])&&!deploymentOn){
   return {code:'DEPLOYMENT OFF',reason:'Deployment authorization is offline'};
  }
  return null;
 };

 const renderCell=(field:string,masterCell=false)=>{
  const row=rowMap.get(field);
  if(!row)return null;
  return <PanelCell
   key={field}
   row={row}
   effective={effectiveFor(field)}
   configured={Boolean(configured[field])}
   lock={lockFor(field)}
   canManage={canManage}
   action={action}
   master={masterCell}
  />;
 };

 return <div className={`authority-hardware-panel ${masterOn?'is-live':'is-master-off'}`}>
  <span className="authority-hardware-screw screw-tl" aria-hidden="true"/>
  <span className="authority-hardware-screw screw-tr" aria-hidden="true"/>
  <span className="authority-hardware-screw screw-bl" aria-hidden="true"/>
  <span className="authority-hardware-screw screw-br" aria-hidden="true"/>
  <div className="authority-hardware-inner">
   <div className="authority-hardware-master">{renderCell('system_enabled',true)}</div>
   <div className="authority-hardware-grid">
    {PRIMARY_FIELDS.map(field=>renderCell(field))}
   </div>
   <div className="authority-hardware-wiring" aria-hidden="true">
    <span className="wire-parent"/>
    <span className="wire-bar"/>
    <span className="wire-drop wire-drop-1"/>
    <span className="wire-drop wire-drop-2"/>
    <span className="wire-drop wire-drop-3"/>
   </div>
   <div className="authority-hardware-grid authority-hardware-children">
    {DEPLOYMENT_FIELDS.map(field=>renderCell(field))}
   </div>
  </div>
 </div>;
}
