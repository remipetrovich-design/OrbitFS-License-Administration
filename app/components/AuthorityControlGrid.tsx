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

function AuthoritySwitch({enabled,warning,label}:{enabled:boolean;warning:boolean;label:string}){
 const {pending}=useFormStatus();
 return <button className={`authority-switch ${enabled?'is-on':'is-off'} ${warning?'is-warning':''}`} disabled={pending} aria-label={`${enabled?'Disable':'Enable'} ${label}`}>
  <span className="authority-switch-track"><span className="authority-switch-knob"/></span>
  <span className="authority-switch-action">{pending?'Applying…':enabled?'On':'Off'}</span>
 </button>;
}

export default function AuthorityControlGrid({rows,canManage,action}:{rows:AuthorityControlRow[];canManage:boolean;action:(formData:FormData)=>Promise<void>}){
 return <div className="authority-control-list">
  {rows.map((row,index)=>{
   const warning=Boolean(row.dangerWhen&&row.enabled);
   return <article className={`authority-control-row ${warning?'is-warning':''} ${row.enabled?'is-enabled':'is-disabled'}`} key={row.field}>
    <div className={'authority-icon authority-icon-'+((index%5)+1)}>{['⚡','◇','◷','▣','⇄'][index%5]}</div>
    <div className="authority-control-copy">
     <div className="authority-control-title"><h3>{row.label}</h3><span className={warning?'state-pill warning':row.enabled?'state-pill online':'state-pill offline'}>{warning?'Maintenance':row.enabled?'Online':'Offline'}</span></div>
     <p>{row.help}</p>
     <small>{row.enabled?row.onText:row.offText}</small>
    </div>
    <div className="authority-control-toggle">
     {canManage?<form action={action}>
      <input type="hidden" name="field" value={row.field}/>
      <input type="hidden" name="value" value={row.enabled?'false':'true'}/>
      <AuthoritySwitch enabled={row.enabled} warning={warning} label={row.label}/>
     </form>:<span className={warning?'state-pill warning':row.enabled?'state-pill online':'state-pill offline'}>{row.enabled?'On':'Off'}</span>}
    </div>
   </article>;
  })}
 </div>;
}
