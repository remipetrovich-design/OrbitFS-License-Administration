import {revalidatePath} from 'next/cache';
import {requireUser} from '../../lib/session';
import {createProduct,listProducts,setProductStatus,updateProduct} from '../../lib/core/products';
import SideNav from '../components/SideNav';
import PageHeader from '../components/PageHeader';
import TableTools from '../components/TableTools';

export const dynamic='force-dynamic';
const managers=['owner','admin'];

async function create(formData:FormData){
 'use server';
 const user=await requireUser();if(!managers.includes(user.role))return;
 const name=String(formData.get('name')||'').trim();
 const slug=String(formData.get('slug')||'').trim().toLowerCase();
 if(!name||!slug)return;
 await createProduct({name,slug,description:String(formData.get('description')||'')||null,actorUserId:user.id,actor:user.email});
 revalidatePath('/products');
}

async function edit(formData:FormData){
 'use server';
 const user=await requireUser();if(!managers.includes(user.role))return;
 const id=String(formData.get('id')||'');
 const name=String(formData.get('name')||'').trim();
 const slug=String(formData.get('slug')||'').trim().toLowerCase();
 if(!id||!name||!slug)return;
 await updateProduct({id,name,slug,description:String(formData.get('description')||'')||null,actorUserId:user.id,actor:user.email});
 revalidatePath('/products');
}

async function status(formData:FormData){
 'use server';
 const user=await requireUser();if(!managers.includes(user.role))return;
 const id=String(formData.get('id')||'');
 const value=String(formData.get('status')||'disabled') as 'active'|'disabled'|'archived';
 if(id&&['active','disabled','archived'].includes(value)){
  await setProductStatus(id,value,user.id,user.email);
  revalidatePath('/products');
 }
}

export default async function Products(){
 const user=await requireUser();
 const products=await listProducts();
 const statuses=[...new Set(products.map((x:any)=>x.status))];
 const canManage=managers.includes(user.role);

 return <div className="shell"><SideNav active="products"/><main className="main">
  <PageHeader eyebrow="System / Products" title="Products" description="Define and maintain the product identities the License Manager can license, validate and release." badge={String(products.length)}/>

  {canManage&&<details className="card collapsible-card">
   <summary className="collapsible-summary">
    <div><div className="eyebrow">Product authority</div><h2>Create product</h2><p className="muted">Add another product identity only when a new licensed product is required.</p></div>
    <span className="collapse-chevron">⌄</span>
   </summary>
   <div className="collapsible-body">
    <form className="form form-grid-3" action={create}>
     <label>Name<input className="input" name="name" required/></label>
     <label>Slug<input className="input" name="slug" placeholder="orbitfs_base" pattern="[a-z0-9][a-z0-9._-]*" required/></label>
     <label>Description<input className="input" name="description"/></label>
     <button className="button">Create product</button>
    </form>
   </div>
  </details>}

  <section className="section">
   <div className="section-head"><div><div className="eyebrow">Product identities</div><h2>Managed products</h2><p className="muted">Compact product records. Expand one product only when you need to edit or change its state.</p></div><span className="badge">{products.length} total</span></div>
   <TableTools targetId="product-list" filters={statuses} pageSize={5}/>
   <div id="product-list" className="managed-record-list">
    {products.map((p:any)=><details className="card managed-record" key={p.id} data-row data-filter={p.status} data-search={`${p.name} ${p.slug} ${p.description||''} ${p.status}`}>
     <summary className="managed-record-summary">
      <div className="managed-record-main"><strong>{p.name}</strong><span className="mono">{p.slug}</span><small className="muted">{p.description||'No description'}</small></div>
      <div className="managed-record-meta"><span className={p.status==='active'?'badge ok':'badge off'}>{p.status}</span><span className="muted">{new Date(p.created_at).toLocaleDateString()}</span><span className="collapse-chevron">⌄</span></div>
     </summary>
     <div className="managed-record-body">
      {canManage?<form className="form product-edit-grid" action={edit}>
       <input type="hidden" name="id" value={p.id}/>
       <label>Name<input className="input" name="name" defaultValue={p.name} required/></label>
       <label>Slug<input className="input" name="slug" defaultValue={p.slug} pattern="[a-z0-9][a-z0-9._-]*" required/><small className="muted">Changing a slug changes the external product identifier. Existing license/release rows remain linked by product ID.</small></label>
       <label className="product-description-field">Description<textarea className="input" name="description" defaultValue={p.description||''} rows={2}/></label>
       <div className="record-actions"><button className="button">Save product</button></div>
      </form>:<div className="notice">Product editing is read-only for your role.</div>}
      {canManage&&<div className="record-danger-row">
       <span className="muted">State controls affect whether new licenses/releases may use this product.</span>
       <div className="actions">
        {p.status!=='archived'&&<form action={status}><input type="hidden" name="id" value={p.id}/><input type="hidden" name="status" value={p.status==='active'?'disabled':'active'}/><button className="button secondary">{p.status==='active'?'Disable':'Enable'}</button></form>}
        {p.status!=='archived'&&<form action={status}><input type="hidden" name="id" value={p.id}/><input type="hidden" name="status" value="archived"/><button className="button danger">Archive</button></form>}
       </div>
      </div>}
     </div>
    </details>)}
    {!products.length&&<div className="empty-state"><strong>No products configured</strong><span>Create a product identity before issuing licenses or releases.</span></div>}
   </div>
  </section>
 </main></div>;
}
