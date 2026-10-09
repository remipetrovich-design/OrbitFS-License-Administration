'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useState} from 'react';

const groups=[
 {label:'Overview',items:[['overview','/','Dashboard','⌂']]},
 {label:'Authority',items:[['licenses','/licenses','Licensing','◇'],['installations','/installations','Installations','▣']]},
 {label:'Release operations',items:[['base','/releases/base','Base Deployment','↳'],['releases','/releases','Release Updates','↻'],['channels','/releases/channels','Release Channels','≡']]},
 {label:'System',items:[['products','/products','Products','◈'],['users','/users','Users','●'],['settings','/settings','API Control','⚡'],['api-keys','/api-keys','API Access','⌁'],['api','/api-docs','API Contract','</>']]}
] as const;

export default function SideNav({active}:{active?:string}){
 const path=usePathname();
 const [open,setOpen]=useState(false);
 const keyFor=(href:string,key:string)=>active===key||(key==='overview'&&path==='/')||(key!=='overview'&&path.startsWith(href));
 return <>
  <button className="mobile-menu-button" onClick={()=>setOpen(true)} aria-label="Open navigation">☰</button>
  {open&&<button className="mobile-scrim" onClick={()=>setOpen(false)} aria-label="Close navigation"/>}
  <aside className={open?'side open':'side'}>
   <div className="brand">
    <div className="brand-mark">LM</div>
    <div className="brand-copy"><strong>License Manager</strong><small>Authority Control Plane</small></div>
    <button className="mobile-close" onClick={()=>setOpen(false)} aria-label="Close navigation">×</button>
   </div>
   <nav className="nav">
    {groups.map(group=><div className="nav-group" key={group.label}>
      <div className="nav-label">{group.label}</div>
      {group.items.map(([key,href,label,icon])=><Link key={key} className={keyFor(href,key)?'active':undefined} href={href} onClick={()=>setOpen(false)}>
        <span className="nav-icon">{icon}</span><span>{label}</span>
      </Link>)}
    </div>)}
   </nav>
   <div className="side-footer">
    <div className="side-status"><strong>License Manager</strong><small>Technical authority for licensing, releases and deployment authorization.</small></div>
      <form action="/api/auth/logout" method="post"><button className="nav-button" type="submit"><span className="nav-icon">⇥</span>Sign out</button></form>
   </div>
  </aside>
 </>;
}
