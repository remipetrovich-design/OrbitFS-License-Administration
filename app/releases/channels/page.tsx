import {requireUser} from '../../../lib/session';
import {db} from '../../../lib/db';
import {listReleaseChannels,saveReleaseChannel} from '../../../lib/core/release-channels';
import SideNav from '../../components/SideNav';
import PageHeader from '../../components/PageHeader';

export const dynamic='force-dynamic';
const roles=['owner','admin'];

function policyFor(c:any){
 if(c.access_mode==='open'||c.self_join_enabled)return 'open';
 if(c.access_request_enabled)return 'request';
 return 'assigned';
}

function policyLabel(c:any){
 const policy=policyFor(c);
 return policy==='open'?'Open · anyone can join':policy==='request'?'Closed beta · request access':'Assigned only';
}

async function save(formData:FormData){
 'use server';
 const user=await requireUser();
 if(!roles.includes(user.role))return;
 const policy=String(formData.get('access_policy')||'assigned');
 const normalized=['open','request','assigned'].includes(policy)?policy:'assigned';
 await saveReleaseChannel({
  channel:String(formData.get('channel')||''),
  label:String(formData.get('label')||''),
  description:String(formData.get('description')||''),
  enabled:formData.get('enabled')==='on',
  customerVisible:formData.get('customer_visible')==='on',
  accessMode:normalized==='open'?'open':'closed',
  accessRequestEnabled:normalized==='request',
  selfJoinEnabled:normalized==='open',
  sortOrder:Number(formData.get('sort_order')||100),
  actorUserId:user.id,
  actor:user.email
 });
}

function AccessPolicyField({value='assigned'}:{value?:string}){
 return <label>Access policy
  <select className="input" name="access_policy" defaultValue={value}>
   <option value="open">Open — anyone can join</option>
   <option value="request">Closed beta — request access</option>
   <option value="assigned">Assigned only — no self-service</option>
  </select>
  <small className="muted">Open enables self-join. Closed beta routes customer requests through Billing Store. Assigned only requires an explicit grant.</small>
 </label>;
}

export default async function ReleaseChannels(){
 const user=await requireUser();
 const [channels,accessRows]=await Promise.all([
  listReleaseChannels(true),
  db().query(`select channel,count(*)::int assignments from release_channel_access group by channel order by channel`)
 ]);
 const accessCounts=new Map(accessRows.rows.map((row:any)=>[row.channel,Number(row.assignments||0)]));
 return <div className="shell">
  <SideNav active="channels"/>
  <main className="main">
   <PageHeader eyebrow="Release Operations / Authority" title="Release Channels" description="Authoritative channel definitions used by Base and Engine releases. Customer requests and assignments remain in Billing Store; License Manager enforces the resulting technical access." badge="MASTER"/>

   <div className="channel-compact-list">
    {channels.map((c:any)=><details className="card channel-card channel-card-compact" key={c.id}>
     <summary className="channel-summary">
      <div className="channel-summary-main">
       <div><h2>{c.label}</h2><span className="mono">{c.channel}</span></div>
       <div className="channel-flags">
        <span className={c.enabled?'badge ok':'badge off'}>{c.enabled?'Enabled':'Disabled'}</span>
        <span className="badge">{policyLabel(c)}</span>
        <span className="badge">{c.customer_visible?'Customer visible':'Internal'}</span>
        <span className="badge">{c.channel==='stable'?'All active licenses':`${accessCounts.get(c.channel)||0} assigned`}</span>
       </div>
      </div>
      <span className="collapse-chevron">⌄</span>
     </summary>
     <div className="channel-body">
      <p className="muted channel-description">{c.description||'No description.'}</p>
      <div className="channel-access-summary">
       <div><span>Technical access</span><strong>{policyLabel(c)}</strong></div>
       <div><span>Assignments</span><strong>{c.channel==='stable'?'Implicit for active licenses':accessCounts.get(c.channel)||0}</strong></div>
       <div><span>Customer surface</span><strong>{c.customer_visible?'Visible':'Internal only'}</strong></div>
      </div>
      {roles.includes(user.role)?<form className="form channel-edit-form" action={save}>
       <input type="hidden" name="channel" value={c.channel}/>
       <div className="channel-form-grid">
        <label>Label<input className="input" name="label" defaultValue={c.label}/></label>
        <label>Sort order<input className="input" name="sort_order" defaultValue={c.sort_order} inputMode="numeric"/></label>
        <label className="channel-description-field">Description<textarea className="input" name="description" defaultValue={c.description} rows={2}/></label>
        <AccessPolicyField value={policyFor(c)}/>
       </div>
       <div className="channel-toggle-grid">
        <label className="check-option"><input type="checkbox" name="enabled" defaultChecked={c.enabled}/><span><b>Enabled</b><small>Release builders may target this channel.</small></span></label>
        <label className="check-option"><input type="checkbox" name="customer_visible" defaultChecked={c.customer_visible}/><span><b>Customer visible</b><small>Allow the channel to appear in customer-facing release surfaces.</small></span></label>
       </div>
       <div className="channel-save-row"><span className="muted">Policy combinations are normalized when saved so self-join and request-only modes cannot conflict.</span><button className="button">Save channel</button></div>
      </form>:<div className="notice">You have read-only access to channel policy.</div>}
     </div>
    </details>)}
   </div>

   {roles.includes(user.role)&&<details className="section card collapsible-card add-channel-card">
    <summary className="collapsible-summary">
     <div><div className="eyebrow">Channel authority</div><h2>Add channel</h2><p className="muted">Create another release lane only when a distinct customer or internal release policy is required.</p></div>
     <span className="collapse-chevron">⌄</span>
    </summary>
    <div className="collapsible-body">
     <form className="form channel-create-form" action={save}>
      <div className="channel-form-grid">
       <label>Channel key<input className="input" name="channel" placeholder="closed-beta" pattern="[a-z0-9][a-z0-9_-]{0,31}" required/><small className="muted">Lowercase letters, numbers, hyphens or underscores.</small></label>
       <label>Label<input className="input" name="label" placeholder="Closed Beta" required/></label>
       <label className="channel-description-field">Description<textarea className="input" name="description" rows={2} placeholder="Who this channel is for and what it contains."/></label>
       <AccessPolicyField value="request"/>
       <label>Sort order<input className="input" name="sort_order" defaultValue="100" inputMode="numeric"/></label>
      </div>
      <div className="channel-toggle-grid">
       <label className="check-option"><input type="checkbox" name="enabled" defaultChecked/><span><b>Enabled</b><small>Allow releases to target this channel.</small></span></label>
       <label className="check-option"><input type="checkbox" name="customer_visible" defaultChecked/><span><b>Customer visible</b><small>Expose the channel through customer-facing release surfaces.</small></span></label>
      </div>
      <div className="channel-save-row"><span className="muted">For a normal public beta, choose Open. For a gated beta with a Billing Store request/form, choose Closed beta.</span><button className="button">Create channel</button></div>
     </form>
    </div>
   </details>}
  </main>
 </div>;
}
