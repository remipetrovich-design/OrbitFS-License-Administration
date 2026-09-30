'use client';
import {useEffect,useState} from 'react';

export default function TableTools({targetId,filters=[],pageSize=0}:{targetId:string;filters?:string[];pageSize?:number}){
 const [query,setQuery]=useState('');
 const [filter,setFilter]=useState('all');
 const [matched,setMatched]=useState(0);
 const [shown,setShown]=useState(0);
 const [page,setPage]=useState(1);
 const [pages,setPages]=useState(1);

 useEffect(()=>{setPage(1)},[query,filter,targetId,pageSize]);

 useEffect(()=>{
  const root=document.getElementById(targetId);
  if(!root)return;
  const rows=[...root.querySelectorAll<HTMLElement>('[data-row]')];
  const matches=rows.filter(row=>{
   const text=(row.dataset.search||row.textContent||'').toLowerCase();
   const value=(row.dataset.filter||'').toLowerCase();
   const okSearch=!query.trim()||text.includes(query.trim().toLowerCase());
   const okFilter=filter==='all'||value.split(/\s+/).includes(filter.toLowerCase());
   return okSearch&&okFilter;
  });
  const pageCount=pageSize>0?Math.max(1,Math.ceil(matches.length/pageSize)):1;
  const safePage=Math.min(page,pageCount);
  if(safePage!==page){setPage(safePage);return}
  const start=pageSize>0?(safePage-1)*pageSize:0;
  const end=pageSize>0?start+pageSize:matches.length;
  const visibleSet=new Set(matches.slice(start,end));
  rows.forEach(row=>{row.hidden=!visibleSet.has(row)});
  setMatched(matches.length);
  setShown(visibleSet.size);
  setPages(pageCount);
 },[query,filter,targetId,page,pageSize]);

 return <div className="table-tools">
  <div className="search-box"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search this view…" aria-label="Search this view"/></div>
  {filters.length>0&&<select className="input filter-select" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All statuses</option>{filters.map(x=><option value={x.toLowerCase()} key={x}>{x}</option>)}</select>}
  <span className="results-count">{pageSize>0?`${shown} of ${matched} shown`:`${matched} shown`}</span>
  {(query||filter!=='all')&&<button className="button secondary" type="button" onClick={()=>{setQuery('');setFilter('all')}}>Clear</button>}
  {pageSize>0&&pages>1&&<div className="pagination-controls" aria-label="Candidate pages">
   <button className="button secondary pagination-button" type="button" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Previous</button>
   <span className="pagination-status">Page {page} of {pages}</span>
   <button className="button secondary pagination-button" type="button" disabled={page>=pages} onClick={()=>setPage(p=>Math.min(pages,p+1))}>Next</button>
  </div>}
 </div>;
}
