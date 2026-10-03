"use client";
import {useCallback,useState} from 'react';
import {useRouter} from 'next/navigation';

export default function LiveRefresh(){
 const router=useRouter();
 const [busy,setBusy]=useState(false);

 const manual=useCallback(()=>{
  if(busy)return;
  setBusy(true);
  router.refresh();
  window.setTimeout(()=>setBusy(false),600);
 },[router,busy]);

 return <div className="live-control">
  <span className="live-label">Manual refresh</span>
  <button className="live-refresh-button" onClick={manual} disabled={busy}>{busy?'Refreshing…':'Refresh'}</button>
 </div>;
}
