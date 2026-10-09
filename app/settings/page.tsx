import {requireUser} from '../../lib/session';
import {getSettings,listRecentPulses,setGithubProfile,setSetting,sendPulse,updateRuntimePolicy,type GithubProfileName,type SettingField} from '../../lib/core/settings';
import {revalidatePath} from 'next/cache';
import {db} from '../../lib/db';
import SideNav from '../components/SideNav';
import PageHeader from '../components/PageHeader';
import AuthorityControlGrid from '../components/AuthorityControlGrid';
import GithubProfileControl from '../components/GithubProfileControl';
import type {SourceSwitchResult} from '../components/GithubProfileControl';
import {reconcileCurrentSourceServiceDeployments} from '../../lib/core/source-activation';

export const dynamic='force-dynamic';

const allowedFields:SettingField[]=['system_enabled','licensing_enabled','maintenance_mode','customer_self_unlock_enabled','release_system_enabled','auto_technical_approval_enabled','deployment_enabled','base_deployment_enabled','update_deployment_enabled','rollback_enabled'];

const manualPulseOptions=[
 {value:'full_recheck',label:'Full licence recheck'},
 {value:'revalidate_license',label:'Licence validation recheck'},
 {value:'refresh_entitlements',label:'Component entitlement recheck'},
 {value:'refresh_binding',label:'Installation binding recheck'},
 {value:'refresh_authority',label:'Authority state recheck'},
 {value:'refresh_runtime_policy',label:'Runtime policy recheck'},
 {value:'invalidate_cache',label:'Invalidate cached licence state'},
 {value:'request_check_in',label:'Request installation check-in'},
 {value:'refresh_release_access',label:'Release access recheck'},
] as const;

const manualPulseScopes=[
 {value:'global',label:'All installations'},
 {value:'product',label:'Product'},
 {value:'license',label:'Specific licence'},
 {value:'installation',label:'Specific installation'},
 {value:'component',label:'Component'},
] as const;

async function updateSettings(formData:FormData){
 'use server';
 const user=await requireUser();if(!['owner','admin'].includes(user.role))return;
 const field=String(formData.get('field')||'') as SettingField;
 if(!allowedFields.includes(field))return;
 await setSetting(field,String(formData.get('value'))==='true',user.id,user.email);
 revalidatePath('/settings');revalidatePath('/');
}

async function switchGithubProfile(_previous:SourceSwitchResult,formData:FormData):Promise<SourceSwitchResult>{
 'use server';
 const user=await requireUser();
 if(user.role!=='owner')return {status:'error',message:'Only the License Manager owner can switch Main/Fallback.'};
 const next=String(formData.get('profile')||'') as GithubProfileName;
 const expected=String(formData.get('expected_profile')||'') as GithubProfileName;
 if(!['primary','fallback'].includes(next)||!['primary','fallback'].includes(expected))
  return {status:'error',message:'Invalid source mode. Refresh the page and try again.'};
 const acknowledged=formData.get('acknowledged')==='on';
 try{
  const switched=await setGithubProfile(next,expected,acknowledged,user.id,user.email);
  if(switched.sourceActivation?.failed?.length)return {
   status:'success',message:'Source mode changed, but service deployment dispatch failed: '+switched.sourceActivation.failed.join('; ')+
    '. The active mode changed; production routing is NOT yet complete.'
  };
 }catch(error){
  // Return a visible form error instead of throwing through Next.js server
  // actions, which produces an opaque production error digest.
  return {status:'error',message:error instanceof Error?error.message:'Source-mode check failed. No change was made.'};
 }
 revalidatePath('/settings');revalidatePath('/');
 return {status:'success',message:'Source mode changed to '+(next==='primary'?'MAIN':'FALLBACK')+
  '. The target service production builds were requested. Domain routing is not complete until all three are healthy.'};
}

async function autoRepairSourceServices():Promise<{status:'ready'|'queued'|'pending'|'error';message:string}>{
 'use server';
 const user=await requireUser();
 if(user.role!=='owner')return {status:'error',message:'Only the owner can reconcile Production service deployments.'};
 try{
  const result=await reconcileCurrentSourceServiceDeployments(user.id,user.email);
  if(result.ready)return {status:'ready',message:'All three selected service projects have a ready Production deployment.'};
  if('pending' in result&&result.pending)return {status:'pending',message:'Service deployment is already queued. Waiting for GitHub and Vercel.'};
  return {status:'queued',message:'Started '+result.queued.length+' selected service deployments in the correct Vercel account.'};
 }catch(error){
  return {status:'error',message:error instanceof Error?error.message:'Service activation failed.'};
 }
}

async function updatePolicy(formData:FormData){
 'use server';
 const user=await requireUser();if(!['owner','admin'].includes(user.role))return;
 await updateRuntimePolicy({
  validation_ttl_seconds:Number(formData.get('validation_ttl_seconds')),
  offline_grace_seconds:Number(formData.get('offline_grace_seconds')),
  pulse_poll_seconds:Number(formData.get('pulse_poll_seconds')),
  max_failed_validations:Number(formData.get('max_failed_validations')),
  allow_offline_grace:formData.get('allow_offline_grace')==='on',
 },user.id,user.email);
 revalidatePath('/settings');revalidatePath('/');
}

async function pulse(formData:FormData){
 'use server';
 const user=await requireUser();if(!['owner','admin'].includes(user.role))return;
 const requested=String(formData.get('pulse_action')||'full_recheck');
 const preset=manualPulseOptions.find(option=>option.value===requested)??manualPulseOptions[0];
 const requestedScope=String(formData.get('pulse_scope')||'global');
 const scope=manualPulseScopes.find(option=>option.value===requestedScope)?.value??'global';
 await sendPulse(user.id,user.email,`manual-${preset.value}`,{
  source:'settings',
  label:preset.label,
  pulse_action:preset.value,
  pulse_scope:scope,
  license_id:String(formData.get('license_id')||'').trim()||null,
  installation_id:String(formData.get('installation_id')||'').trim()||null,
  product:String(formData.get('product')||'').trim().toLowerCase()||null,
  component:String(formData.get('component')||'').trim().toLowerCase()||null,
 });
 revalidatePath('/settings');revalidatePath('/');
}


async function forceGlobalRevalidation(){
 'use server';
 const user=await requireUser();if(!['owner','admin'].includes(user.role))return;
 await sendPulse(user.id,user.email,'manual-global-license-check',{
  source:'settings',
  label:'Manual global licence check',
  pulse_action:'full_recheck',
  pulse_scope:'global',
 });
 revalidatePath('/settings');revalidatePath('/');
}


async function resetReleaseLab(formData:FormData){
 'use server';
 const user=await requireUser();if(user.role!=='owner')return;
 const confirmed=formData.get('confirmation')==='on';
 if(!confirmed)return;
 const pool=db();
 const client=await pool.connect();
 try{
  await client.query('begin');
  const releaseCount=Number((await client.query("select count(*)::int count from releases where lower(status)<>'published'")).rows[0]?.count||0);
  const publishedPreserved=Number((await client.query("select count(*)::int count from releases where lower(status)='published'")).rows[0]?.count||0);
  const deploymentEventCount=Number((await client.query("select count(*)::int count from deployment_events where action in ('deploy','base_update','update','redeploy','rollback')")).rows[0]?.count||0);
  const activationCount=Number((await client.query("select count(*)::int count from activations where product_version is not null or last_deployment_id is not null or last_deployment_url is not null or deployment_count<>0 or coalesce(current_components,'{}'::jsonb)<>'{}'::jsonb")).rows[0]?.count||0);

  await client.query("delete from deployment_events where action in ('deploy','base_update','update','redeploy','rollback')");
  await client.query("delete from releases where lower(status)<>'published'");
  await client.query(`update activations
    set product_version=null,
        last_deployment_id=null,
        last_deployment_url=null,
        last_deployment_status=null,
        last_operation=null,
        deployment_count=0,
        current_components='{}'::jsonb`);
  await client.query(
   `insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details)
    values($1,$2,'release_lab.reset','system','release-lab',$3)`,
   [user.id,user.email,JSON.stringify({
    baseline_version:'1.0.0',
    releases_archived:releaseCount,
    deployment_events_deleted:deploymentEventCount,
    activation_summaries_cleared:activationCount,
    customer_provider_resources_deleted:false,
    licenses_deleted:false,
    audit_history_deleted:false,
   })]
  );
  await client.query('commit');
 }catch(error){
  await client.query('rollback').catch(()=>{});
  throw error;
 }finally{
  client.release();
 }
 revalidatePath('/settings');revalidatePath('/releases');revalidatePath('/installations');revalidatePath('/');
}

export default async function Settings(){
 const user=await requireUser();
 const s=await getSettings();
 const recentPulses=await listRecentPulses(20);
 const canManage=['owner','admin'].includes(user.role);

 const rows=[
  {field:'system_enabled',label:'External authority / master shutdown',help:'This is the master shutdown switch for external License Manager authority. Turning it off rejects runtime licensing, release and deployment authority requests while leaving this admin panel available.',onText:'External API authority is online',offText:'External API authority is offline',enabled:Boolean(s.system_enabled)},
  {field:'licensing_enabled',label:'License validation & issuance',help:'Controls license issuance and runtime validation. Turning this off makes license checks fail closed and sends a pulse so connected runtimes re-check authority.',onText:'Licensing is accepting validations',offText:'Licensing validations are blocked',enabled:Boolean(s.licensing_enabled)},
  {field:'maintenance_mode',label:'Maintenance enforcement',help:'Makes licence validation and issuance deliberately unavailable and disables customer installation unlock while keeping the admin plane accessible. Offline grace remains governed by the runtime policy below.',onText:'Maintenance enforcement is active',offText:'Normal validation mode',dangerWhen:true,enabled:Boolean(s.maintenance_mode)},
  {field:'customer_self_unlock_enabled',label:'Customer installation unlock',help:'Allows customers to release their currently bound OrbitFS installation from the Billing Store so the same licence can bind to a reinstall or replacement system. OrbitFS still permits only one bound system at a time.',onText:'Customers can unlock / release their installation',offText:'Only administrators can release installations',enabled:Boolean(s.customer_self_unlock_enabled)},
  {field:'release_system_enabled',label:'Release authority',help:'Controls authoritative release intake, validation and state APIs. Billing Store publication remains a separate final gate.',onText:'Release authority is online',offText:'Release authority is blocked',enabled:Boolean(s.release_system_enabled)},
  {field:'auto_technical_approval_enabled',label:'Auto technical approval',help:'When every License Manager technical validation check passes for the exact source/artifact, automatically mark the release technically approved. This never publishes, exposes to customers, or starts deployment; Billing Store Admin remains the final publication gate.',onText:'Passed releases auto-approve for Billing Store review',offText:'Technical approval requires a manual decision',enabled:Boolean(s.auto_technical_approval_enabled)},
  {field:'deployment_enabled',label:'Deployment authorization',help:'Master deployment authorization gate. Turning this off blocks Base, Update and rollback authorization while customer deployers remain the execution layer.',onText:'Deployment authorization is online',offText:'All deployment authorization is blocked',enabled:Boolean(s.deployment_enabled)},
  {field:'base_deployment_enabled',label:'Base deployment authorization',help:'Allows customer Base install and redeploy authorization. Billing Store does not own this technical gate.',onText:'Base deployment authorization is online',offText:'Base deployment authorization is blocked',enabled:Boolean(s.base_deployment_enabled)},
  {field:'update_deployment_enabled',label:'Update deployment authorization',help:'Allows manifest-driven Update deployment authorization after technical approval and customer publication.',onText:'Update deployment authorization is online',offText:'Update deployment authorization is blocked',enabled:Boolean(s.update_deployment_enabled)},
  {field:'rollback_enabled',label:'Rollback authorization',help:'Allows customer rollback/checkpoint authorization where the customer deployer supports it.',onText:'Rollback authorization is online',offText:'Rollback authorization is blocked',enabled:Boolean(s.rollback_enabled)}
 ];

 const masterEnabled=Boolean(s.system_enabled);
 const githubProfile=(String(s.github_profile||'fallback').toLowerCase()==='primary'?'primary':'fallback') as 'primary'|'fallback';
 const maintenance=masterEnabled&&Boolean(s.maintenance_mode);
 const deploymentEnabled=masterEnabled&&Boolean(s.deployment_enabled);
 const effectiveEnabled=(field:string,configured:boolean)=>{
  if(field==='system_enabled')return configured;
  if(!masterEnabled)return false;
  if((field==='licensing_enabled'||field==='customer_self_unlock_enabled')&&maintenance)return false;
  if(['base_deployment_enabled','update_deployment_enabled','rollback_enabled'].includes(field)&&!deploymentEnabled)return false;
  return configured;
 };
 const serviceRows=rows.filter(r=>!r.dangerWhen);
 const liveCount=serviceRows.filter(r=>effectiveEnabled(r.field,r.enabled)).length;

 return <div className="shell"><SideNav active="settings"/><main className="main">
  <PageHeader eyebrow="System / Runtime control" title="API Control Center" description="Control License Manager authority services and runtime enforcement. Integration credentials are managed separately under API Access." badge={!masterEnabled?'OFFLINE':maintenance?'MAINTENANCE':'LIVE'}/>

  <div className="grid dashboard-metrics api-metrics">
   <div className="card metric-card"><div className="metric-icon icon-green">⚡</div><div><span className="metric-label">Authority services</span><strong className="metric">{liveCount}/{serviceRows.length}</strong><small>{masterEnabled?'Master authority enabled':'Master authority offline'}</small></div></div>
   <div className="card metric-card"><div className="metric-icon icon-red">◷</div><div><span className="metric-label">Runtime mode</span><strong className="metric api-mode-metric">{!masterEnabled?'Offline':maintenance?'Maintenance':Boolean(s.licensing_enabled)?'Online':'Blocked'}</strong><small>License validation enforcement</small></div></div>
   <div className="card metric-card"><div className="metric-icon icon-blue">⌁</div><div><span className="metric-label">Validation TTL</span><strong className="metric">{Number(s.validation_ttl_seconds||5400)}s</strong><small>Pulse poll {Number(s.pulse_poll_seconds||5400)}s</small></div></div>
   <div className="card metric-card"><div className="metric-icon icon-indigo">#</div><div><span className="metric-label">Pulse revision</span><strong className="metric">{Number(s.pulse_revision||0)}</strong><small>{s.pulse_at?new Date(s.pulse_at).toLocaleString():'No pulse recorded'}</small></div></div>
  </div>

  <section className="section">
   <div className="section-head"><div><div className="eyebrow">Runtime authority</div><h2>API controls</h2><p className="muted">MAIN / FALLBACK sits directly above the authority board. Lever up is OFF/red and lever down is ON/green. Master shutdown disables every child control; maintenance suppresses licence validation and customer unlock; deployment authorization suppresses Base, Update and rollback controls. Configured child states are preserved while a parent is offline.</p></div></div>
   <GithubProfileControl profile={githubProfile} masterOffline={!masterEnabled} canManage={user.role==='owner'} action={switchGithubProfile} reconcileAction={autoRepairSourceServices}
      missingRequirements={githubProfile==='primary'
       ? ['ORBITFS_FALLBACK_GITHUB_TOKEN','ORBITFS_FALLBACK_VERCEL_TOKEN'].filter(key=>!String(process.env[key]||'').trim() || /^(change-me|placeholder|replace-with)/i.test(String(process.env[key]||'').trim()))
       : ['ORBITFS_MAIN_VERCEL_TOKEN',...(!String(process.env.ORBITFS_PRIMARY_GITHUB_TOKEN||process.env.ORBITFS_RELEASE_DISPATCH_TOKEN||'').trim()?['ORBITFS_PRIMARY_GITHUB_TOKEN or ORBITFS_RELEASE_DISPATCH_TOKEN']:[])].filter(key=>key.includes(' or ')||!String(process.env[key]||'').trim())}
     />
   <AuthorityControlGrid rows={rows} canManage={canManage} action={updateSettings}/>
  </section>

  <details className="section card collapsible-card">
   <summary className="collapsible-summary">
    <div><div className="eyebrow">Enforcement</div><h2>Runtime validation policy</h2><p className="muted">Cache, pulse polling, failure thresholds and offline grace. Expand only when changing enforcement behaviour.</p></div>
    <div className="collapsible-summary-actions"><span className="header-badge">PULSE #{Number(s.pulse_revision||0)}</span><span className="collapse-chevron">⌄</span></div>
   </summary>
   <div className="collapsible-body">
    <div className="policy-status">
     <div><span className="status-light online"/><strong>Last authoritative pulse</strong><small>{s.pulse_at?new Date(s.pulse_at).toLocaleString():'Never'} · {s.pulse_reason||'No reason recorded'}</small></div>
     {canManage&&<form action={forceGlobalRevalidation}><button className="button">Send licence recheck now</button><small className="muted" style={{display:'block',marginTop:6}}>Manual override. Normal runtime validation and pulse checks remain on the 90-minute policy.</small></form>}
    </div>
    {canManage&&<form action={pulse} className="policy-grid">
     <label><span>Pulse action</span><select className="input" name="pulse_action" defaultValue="full_recheck">{manualPulseOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
     <label><span>Target scope</span><select className="input" name="pulse_scope" defaultValue="global">{manualPulseScopes.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
     <label><span>Licence ID</span><input className="input" name="license_id" placeholder="Optional unless licence-scoped"/></label>
     <label><span>Installation ID</span><input className="input" name="installation_id" placeholder="Optional unless installation-scoped"/></label>
     <label><span>Product</span><input className="input" name="product" defaultValue="orbitfs_base"/></label>
     <label><span>Component</span><input className="input" name="component" placeholder="orbitfs_base / apex / mcp / studio"/></label>
     <div className="policy-submit"><button className="button">Send targeted pulse</button></div>
    </form>}
    {canManage?<form className="policy-grid" action={updatePolicy}>
     <label><span>Validation cache TTL</span><div className="number-input"><input className="input" name="validation_ttl_seconds" type="number" min="5" max="86400" defaultValue={Number(s.validation_ttl_seconds||5400)}/><b>sec</b></div></label>
     <label><span>Pulse poll interval</span><div className="number-input"><input className="input" name="pulse_poll_seconds" type="number" min="60" max="86400" defaultValue={Number(s.pulse_poll_seconds||5400)}/><b>sec</b></div></label>
     <label><span>Failed validations before lock</span><div className="number-input"><input className="input" name="max_failed_validations" type="number" min="1" max="100" defaultValue={Number(s.max_failed_validations||3)}/><b>tries</b></div></label>
     <label><span>Offline grace</span><div className="number-input"><input className="input" name="offline_grace_seconds" type="number" min="0" max="604800" defaultValue={Number(s.offline_grace_seconds||0)}/><b>sec</b></div></label>
     <label className="toggle-line"><input type="checkbox" name="allow_offline_grace" defaultChecked={Boolean(s.allow_offline_grace)}/><span><b>Allow offline grace</b><small>Temporary use after a previously successful validation when the authority cannot be reached.</small></span></label>
     <div className="policy-submit"><button className="button">Save runtime policy</button></div>
    </form>:<div className="muted">Runtime policy is read-only for your role.</div>}
   </div>
  </details>


  {user.role==='owner'&&<section className="section card">
   <div className="section-head"><div><div className="eyebrow">Danger zone</div><h2>Release lab reset</h2><p className="muted">Deletes every License Manager Base/Update release record that is not currently published, clears deployment/update event history and activation deployment/version summaries, and leaves currently published releases untouched. It does not delete customer Supabase/Vercel resources, licences, users, channels or audit history.</p></div><span className="badge">OWNER ONLY</span></div>
   <form action={resetReleaseLab} className="policy-grid">
    <label className="toggle-line"><input type="checkbox" name="confirmation" required/><span><b>I understand this permanently deletes every release that is not currently published</b><small>Currently published releases remain protected. Customer Supabase/Vercel resources, licences, users, channels and audit history are not deleted.</small></span></label>
    <div className="policy-submit"><button className="button danger">Clear non-published release/deployment state</button></div>
   </form>
  </section>}

  <section className="section card">
   <div className="section-head"><div><div className="eyebrow">Pulse delivery</div><h2>Recent licence directives</h2><p className="muted">Targeted runtime directives and client-reported delivery state. Receipts are observability only; License Manager validation remains authoritative.</p></div><span className="badge">{recentPulses.length} recent</span></div>
   {recentPulses.length?<div className="table-shell"><table className="table"><thead><tr><th>Revision</th><th>Action</th><th>Target</th><th>Reason</th><th>Receipts</th><th>Created</th></tr></thead><tbody>
    {recentPulses.map((p:any)=>{const target=p.scope==='global'?'All installations':p.scope==='license'?p.license_id:p.scope==='installation'?p.installation_id:p.scope==='product'?p.product:p.component;return <tr key={p.id}>
     <td><strong className="mono">#{Number(p.revision)}</strong></td>
     <td><strong>{String(p.action||'').replaceAll('_',' ')}</strong><small className="muted" style={{display:'block'}}>{p.scope}</small></td>
     <td><span className="mono">{target||'—'}</span></td>
     <td>{p.reason||'—'}</td>
     <td><div>{Number(p.applied_count||0)} applied · {Number(p.failed_count||0)} failed</div><small className="muted">{Number(p.received_count||0)} received · {Number(p.receipt_count||0)} total</small></td>
     <td>{p.created_at?new Date(p.created_at).toLocaleString():'—'}</td>
    </tr>})}
   </tbody></table></div>:<div className="muted">No targeted pulse records yet. Apply the 20260929 targeted pulse migration before using protocol v2.</div>}
  </section>
 </main></div>;
}
