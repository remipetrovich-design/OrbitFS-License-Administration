'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';

export default function RegenerateApiKey({id,name,action}:{id:string;name:string;action:(formData:FormData)=>Promise<string|undefined>}){
 const router=useRouter();
 const [busy,setBusy]=useState(false);
 const [key,setKey]=useState('');
 const [error,setError]=useState('');
 const [copied,setCopied]=useState(false);
 async function regenerate(){
  if(!window.confirm('Regenerate API key "'+name+'"? The existing key will stop working immediately. You must update every GitHub, Vercel and other integration using it. The replacement will only be displayed once.'))return;
  setBusy(true);setError('');setCopied(false);
  try{
   const data=new FormData();data.set('id',id);
   const generated=await action(data);
   if(!generated)throw new Error('API key regeneration was not authorized.');
   setKey(generated);
  }catch(err){setError(err instanceof Error?err.message:'Unable to regenerate API key.');}
  finally{setBusy(false);}
 }
 async function copy(){
  try{await navigator.clipboard.writeText(key);setCopied(true);}
  catch{setError('Clipboard copy failed. Select and copy the key manually before closing.');}
 }
 return <>
  <button type="button" className="button secondary" disabled={busy||Boolean(key)} onClick={()=>void regenerate()}>{busy?'Regenerating…':'Regenerate'}</button>
  {error&&!key&&<span role="alert" className="muted">{error}</span>}
  {key&&<div role="dialog" aria-modal="true" aria-label={'Regenerated key for '+name} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
   <div className="card w-full max-w-xl space-y-4 p-5">
    <h2>New API key for {name}</h2>
    <p><strong>Copy this now. It cannot be shown again.</strong> The previous key has been invalidated. Update any GitHub Actions secrets, Vercel environment variables and other systems using this key before continuing.</p>
    <code className="block break-all select-all rounded border p-3">{key}</code>
    {error&&<p role="alert">{error}</p>}
    <div className="actions">
     <button className="button" type="button" onClick={()=>void copy()}>{copied?'Copied':'Copy new key'}</button>
     <button className="button secondary" type="button" onClick={()=>{setKey('');router.refresh();}}>I have saved the key</button>
    </div>
   </div>
  </div>}
 </>;
}
