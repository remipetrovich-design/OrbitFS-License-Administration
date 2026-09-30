"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';

export default function LiveRefresh({intervalMs=60000}:{intervalMs?:number}){
 const router=useRouter();
 const lastSyncRef=useRef(Date.now());
 const [busy,setBusy]=useState(false);
 const [seconds,setSeconds]=useState(0);

 const refresh=useCallback((force=false)=>{
  if(document.visibilityState!=='visible')return;
  const age=Date.now()-lastSyncRef.current;
  if(!force&&age<Math.min(intervalMs,15000))return;
  router.refresh();
  lastSyncRef.current=Date.now();
  setSeconds(0);
 },[router,intervalMs]);

 useEffect(()=>{
  const timer=window.setInterval(()=>refresh(true),intervalMs);
  const tick=window.setInterval(()=>setSeconds(Math.floor((Date.now()-lastSyncRef.current)/1000)),1000);
  const onFocus=()=>refresh(false);
  const onVisible=()=>{if(document.visibilityState==='visible')refresh(false)};
  window.addEventListener('focus',onFocus);
  document.addEventListener('visibilitychange',onVisible);
  return()=>{clearInterval(timer);clearInterval(tick);window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onVisible)};
 },[refresh,intervalMs]);

 const manual=()=>{
  setBusy(true);
  refresh(true);
  window.setTimeout(()=>setBusy(false),600);
 };

 const syncLabel=seconds<2?'now':seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}m`;
 return <div className="live-control">
  <span className="live-dot-indicator"/>
  <span className="live-label">Live <span className="muted">· synced <span className="live-age">{syncLabel}</span></span></span>
  <button className="live-refresh-button" onClick={manual} disabled={busy}>{busy?'Syncing…':'Refresh'}</button>
 </div>;
}
