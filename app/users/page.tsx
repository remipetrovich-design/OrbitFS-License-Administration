import {revalidatePath} from 'next/cache';
import {db} from '../../lib/db';
import {requireUser,hashPassword} from '../../lib/session';
import SideNav from '../components/SideNav';
import PageHeader from '../components/PageHeader';
import TableTools from '../components/TableTools';

export const dynamic='force-dynamic';
const managers=['owner','admin'];
const editableRoles=['admin','operator','viewer'];

async function createUser(formData:FormData){
 'use server';
 const actor=await requireUser();if(!managers.includes(actor.role))return;
 const email=String(formData.get('email')||'').trim().toLowerCase();
 const name=String(formData.get('name')||'').trim();
 const password=String(formData.get('password')||'');
 const role=String(formData.get('role')||'operator');
 if(!email||!name||password.length<12||!editableRoles.includes(role))return;
 const {hash,salt}=hashPassword(password);
 const result=await db().query(`insert into users(email,password_hash,password_salt,display_name,role) values($1,$2,$3,$4,$5) returning id`,[email,hash,salt,name,role]);
 await db().query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'user.create','user',$3,$4)`,[actor.id,actor.email,result.rows[0].id,JSON.stringify({email,role})]);
 revalidatePath('/users');
}

async function updateUser(formData:FormData){
 'use server';
 const actor=await requireUser();if(!managers.includes(actor.role))return;
 const id=String(formData.get('id')||'');
 if(!id)return;
 const current=(await db().query('select id,email,display_name,role,status from users where id=$1 limit 1',[id])).rows[0];
 if(!current)return;
 if(actor.role!=='owner'&&current.role==='owner')return;
 const email=String(formData.get('email')||'').trim().toLowerCase();
 const name=String(formData.get('name')||'').trim();
 const requestedRole=String(formData.get('role')||current.role);
 const role=current.role==='owner'?'owner':editableRoles.includes(requestedRole)?requestedRole:current.role;
 const status=String(formData.get('status')||current.status)==='disabled'?'disabled':'active';
 const password=String(formData.get('password')||'');
 if(!email||!name)return;
 if(password&&password.length<12)return;
 if(password){
  const {hash,salt}=hashPassword(password);
  await db().query('update users set email=$1,display_name=$2,role=$3,status=$4,password_hash=$5,password_salt=$6,updated_at=now() where id=$7',[email,name,role,status,hash,salt,id]);
 }else{
  await db().query('update users set email=$1,display_name=$2,role=$3,status=$4,updated_at=now() where id=$5',[email,name,role,status,id]);
 }
 await db().query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'user.update','user',$3,$4)`,[actor.id,actor.email,id,JSON.stringify({before:current,after:{email,display_name:name,role,status},password_reset:Boolean(password)})]);
 revalidatePath('/users');
}

async function deleteUser(formData:FormData){
 'use server';
 const actor=await requireUser();if(!managers.includes(actor.role))return;
 const id=String(formData.get('id')||'');
 if(!id||id===actor.id)return;
 const target=(await db().query('select id,email,display_name,role from users where id=$1 limit 1',[id])).rows[0];
 if(!target||target.role==='owner')return;
 await db().query('delete from users where id=$1',[id]);
 await db().query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'user.delete','user',$3,$4)`,[actor.id,actor.email,id,JSON.stringify({email:target.email,display_name:target.display_name,role:target.role})]);
 revalidatePath('/users');
}

export default async function Users(){
 const actor=await requireUser();
 const users=(await db().query('select id,email,display_name,role,status,last_login_at,created_at from users order by created_at desc')).rows;
 const canManage=managers.includes(actor.role);

 return <div className="shell"><SideNav active="users"/><main className="main">
  <PageHeader eyebrow="System / Users" title="Users" description="Manage local License Manager administrators, roles and access state." badge={actor.role.toUpperCase()}/>

  {canManage&&<details className="card collapsible-card">
   <summary className="collapsible-summary"><div><div className="eyebrow">Administrative access</div><h2>Create user</h2><p className="muted">Create a local admin-plane account only when another operator needs access.</p></div><span className="collapse-chevron">⌄</span></summary>
   <div className="collapsible-body"><form className="form form-grid-4" action={createUser}>
    <label>Name<input className="input" name="name" required/></label>
    <label>Email<input className="input" type="email" name="email" required/></label>
    <label>Temporary password<input className="input" type="password" name="password" minLength={12} required/></label>
    <label>Role<select className="input" name="role"><option value="admin">Admin</option><option value="operator">Operator</option><option value="viewer">Viewer</option></select></label>
    <button className="button">Create user</button>
   </form></div>
  </details>}

  <section className="section">
   <div className="section-head"><div><div className="eyebrow">Panel access</div><h2>Managed users</h2><p className="muted">Expand a user to edit identity, role, access state or reset the password.</p></div><span className="badge">{users.length} total</span></div>
   <TableTools targetId="user-list" filters={['active','disabled']} pageSize={6}/>
   <div id="user-list" className="managed-record-list">
    {users.map((u:any)=>{
     const canEdit=actor.role==='owner'||u.role!=='owner';
     const canDelete=canManage&&u.role!=='owner'&&u.id!==actor.id;
     return <details className="card managed-record" key={u.id} data-row data-filter={u.status} data-search={`${u.display_name} ${u.email} ${u.role} ${u.status}`}>
      <summary className="managed-record-summary">
       <div className="managed-record-main"><strong>{u.display_name}</strong><span>{u.email}</span><small className="muted">{u.last_login_at?`Last sign in ${new Date(u.last_login_at).toLocaleString()}`:'Never signed in'}</small></div>
       <div className="managed-record-meta"><span className="badge">{u.role}</span><span className={u.status==='active'?'badge ok':'badge off'}>{u.status}</span><span className="collapse-chevron">⌄</span></div>
      </summary>
      <div className="managed-record-body">
       {canManage&&canEdit?<form className="form user-edit-grid" action={updateUser}>
        <input type="hidden" name="id" value={u.id}/>
        <label>Name<input className="input" name="name" defaultValue={u.display_name} required/></label>
        <label>Email<input className="input" type="email" name="email" defaultValue={u.email} required/></label>
        <label>Role{u.role==='owner'?<input className="input" value="owner" disabled/>:<select className="input" name="role" defaultValue={u.role}><option value="admin">Admin</option><option value="operator">Operator</option><option value="viewer">Viewer</option></select>}</label>
        <label>Status<select className="input" name="status" defaultValue={u.status}><option value="active">Active</option><option value="disabled">Disabled</option></select></label>
        <label className="user-password-field">New password <span className="muted">(optional)</span><input className="input" type="password" name="password" minLength={12} placeholder="Leave blank to keep current password"/></label>
        <div className="record-actions"><button className="button">Save user</button></div>
       </form>:<div className="notice">This account is protected from editing by your current role.</div>}
       {canDelete&&<div className="record-danger-row"><span className="muted">Deleting a user removes the local account and its active sessions. Audit history remains.</span><form action={deleteUser}><input type="hidden" name="id" value={u.id}/><button className="button danger">Delete user</button></form></div>}
      </div>
     </details>;
    })}
   </div>
  </section>
 </main></div>;
}
