import {requireUser} from '../../lib/session';
import {listApiKeys,createApiKey,revokeApiKey,deleteRevokedApiKey,ApiScope} from '../../lib/core/api-keys';
import ApiKeyForm from './form';
import SideNav from '../components/SideNav';
import PageHeader from '../components/PageHeader';
import TableTools from '../components/TableTools';

export const dynamic='force-dynamic';
const scopes:ApiScope[]=['license.issue','license.validate','license.manage','releases.read','releases.write','deployment.read','deployment.write'];

async function create(formData:FormData){
 'use server';
 const u=await requireUser();if(!['owner','admin'].includes(u.role))return;
 const name=String(formData.get('name')||'').trim();
 const selected=String(formData.get('scopes')||'').split(',').filter((x):x is ApiScope=>scopes.includes(x as ApiScope));
 if(!name||!selected.length)return;
 const result=await createApiKey({name,scopes:selected,actorUserId:u.id});
 return result.key;
}
async function revoke(formData:FormData){'use server';const u=await requireUser();if(!['owner','admin'].includes(u.role))return;const id=String(formData.get('id')||'');if(id)await revokeApiKey(id,u.id);}
async function deleteRevoked(formData:FormData){'use server';const u=await requireUser();if(!['owner','admin'].includes(u.role))return;const id=String(formData.get('id')||'');if(id)await deleteRevokedApiKey(id,u.id);}

export default async function ApiKeys(){
 const u=await requireUser();
 const keys=await listApiKeys();
 const statuses=[...new Set(keys.map((k:any)=>k.status))];
 const canManage=['owner','admin'].includes(u.role);

 return <div className="shell"><SideNav active="api-keys"/><main className="main">
  <PageHeader eyebrow="System / Access" title="API Access" description="Machine credentials for Billing Store, release builders and deployment clients. Each integration should use its own least-privilege key." badge={String(keys.length)}/>

  <section className="card form-card">
   <div className="section-head"><div><div className="eyebrow">Machine credentials</div><h2>Create integration key</h2><p className="muted">Issue credentials here only. API Control no longer duplicates credential management.</p></div></div>
   {canManage?<ApiKeyForm action={create} scopes={scopes}/>:<div className="notice">Only Owner and Admin accounts can create or revoke integration keys.</div>}
  </section>

  <details className="section card collapsible-card">
   <summary className="collapsible-summary">
    <div><div className="eyebrow">Credential inventory</div><h2>Managed keys</h2><p className="muted">Compact credential history. Only the final four characters remain visible after creation.</p></div>
    <div className="collapsible-summary-actions"><span className="badge">{keys.length} total</span><span className="collapse-chevron">⌄</span></div>
   </summary>
   <div className="collapsible-body">
    <TableTools targetId="api-key-table" filters={statuses} pageSize={6}/>
    <div className="table-shell" id="api-key-table"><table className="table api-key-table">
     <thead><tr><th>Name</th><th>Key</th><th>Scopes</th><th>Status</th><th>Last used</th><th>Control</th></tr></thead>
     <tbody>{keys.map((k:any)=><tr key={k.id} data-row data-filter={k.status} data-search={`${k.name} ${k.key_last4} ${Array.isArray(k.scopes)?k.scopes.join(' '):String(k.scopes)} ${k.status}`}>
      <td><strong>{k.name}</strong></td>
      <td className="mono">lm_••••{k.key_last4}</td>
      <td><div className="compact-scope-list">{(Array.isArray(k.scopes)?k.scopes:[]).map((scope:string)=><span className="badge" key={scope}>{scope}</span>)}</div></td>
      <td><span className={k.status==='active'?'state-pill online':'state-pill offline'}>{k.status}</span></td>
      <td>{k.last_used_at?new Date(k.last_used_at).toLocaleString():'Never'}</td>
      <td>{canManage&&<div className="actions">{k.status==='active'&&<form action={revoke}><input type="hidden" name="id" value={k.id}/><button className="button danger">Revoke</button></form>}{k.status==='revoked'&&<form action={deleteRevoked}><input type="hidden" name="id" value={k.id}/><button className="button danger">Delete</button></form>}</div>}</td>
     </tr>)}</tbody>
    </table></div>
   </div>
  </details>
 </main></div>;
}
