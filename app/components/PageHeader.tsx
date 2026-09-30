import Link from 'next/link';
import LiveRefresh from './LiveRefresh';

export default function PageHeader({eyebrow,title,description,badge,backHref,backLabel='Back'}:{eyebrow?:string;title:string;description?:string;badge?:string;backHref?:string;backLabel?:string}){
 return <header className="page-header">
  <div className="page-heading">
   {backHref&&<Link href={backHref} className="back-link">← {backLabel}</Link>}
   {eyebrow&&<div className="eyebrow">{eyebrow}</div>}
   <div className="page-title-row">
    <div><h1 className="title">{title}</h1>{description&&<p className="page-description">{description}</p>}</div>
    {badge&&<span className="header-badge">{badge}</span>}
   </div>
  </div>
  <LiveRefresh/>
 </header>;
}
