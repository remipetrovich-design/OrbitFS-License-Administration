'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';

type RotatedKey={key:string;name:string;last4:string};
export default function RegenerateApiKey({
  id,name,action
}:{
  id:string;
  name:string;
  action:(id:string)=>Promise<RotatedKey>;
}){
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [rotated,setRotated]=useState<RotatedKey|null>(null);
  const [error,setError]=useState('');
  async function regenerate(){
    if(!window.confirm('Regenerate API key "'+name+'"? The existing key stops working immediately. Update all services using it with the new value before continuing their operations. Permissions will not change.'))return;
    setBusy(true);
    setError('');
    setRotated(null);
    try{
      const result=await action(id);
      setRotated(result);
    }catch(err){
      setError(err instanceof Error?err.message:'Unable to regenerate this API key.');
    }finally{setBusy(false)}
  }
  function dismiss(){
    setRotated(null);
    router.refresh();
  }
  return <>
    <button type="button" className="button secondary" disabled={busy||Boolean(rotated)} onClick={()=>void regenerate()}>{busy?'Regenerating…':'Regenerate'}</button>
    {error&&<p role="alert" className="muted">{error}</p>}
    {rotated&&<div className="key-created" role="status">
      <strong>New key for {rotated.name} — copy it now. It will not be shown again.</strong>
      <code style={{overflowWrap:'anywhere',whiteSpace:'normal'}}>{rotated.key}</code>
      <p className="muted">The previous key is invalid. Update GitHub Actions, Vercel or other services that use it. Name and permissions are unchanged.</p>
      <button type="button" className="button secondary" onClick={()=>void navigator.clipboard?.writeText(rotated.key)}>Copy new key</button>
      <button type="button" className="button secondary" onClick={dismiss}>I've saved this key</button>
    </div>}
  </>;
}
