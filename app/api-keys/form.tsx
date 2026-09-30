'use client';
import {useState} from 'react';

export default function ApiKeyForm({action,scopes}:{action:(formData:FormData)=>Promise<string|undefined>;scopes:string[]}){
 const [selected,setSelected]=useState<string[]>(scopes);
 const [created,setCreated]=useState('');

 async function submit(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();
  const form=e.currentTarget;
  const fd=new FormData(form);
  fd.set('scopes',selected.join(','));
  const key=await action(fd);
  if(key){setCreated(key);form.reset();setSelected(scopes)}
 }

 return <div className="api-key-create-panel">
  <form className="form" onSubmit={submit}>
   <label>Name<input className="input" name="name" placeholder="Billing Store / release builder / deployer" required/></label>
   <div><strong className="form-label">Permissions</strong><div className="scope-grid compact-scope-grid">{scopes.map(s=><label className="scope-chip" key={s}><input type="checkbox" checked={selected.includes(s)} onChange={e=>setSelected(v=>e.target.checked?[...v,s]:v.filter(x=>x!==s))}/><span><b>{s}</b></span></label>)}</div></div>
   <div><button className="button" type="submit" disabled={!selected.length}>Create integration key</button></div>
  </form>
  {created&&<div className="key-created"><strong>New integration key — copy it now. It will not be shown again.</strong><code>{created}</code><button className="button secondary" type="button" onClick={()=>void navigator.clipboard?.writeText(created)}>Copy key</button></div>}
 </div>;
}
