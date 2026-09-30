import { db } from '../db';

export function normalizeProductSlug(value:string){const slug=String(value||'').trim().toLowerCase();return slug==='orbitfs'?'orbitfs_base':slug;}

export async function createProduct(input:{name:string;slug:string;description?:string|null;actorUserId?:string|null;actor?:string}){
  const result=await db().query(`insert into products(name,slug,description) values($1,$2,$3) returning *`,[input.name,input.slug,input.description??null]);
  const row=result.rows[0];
  await db().query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'product.create','product',$3,$4)`,[input.actorUserId??null,input.actor??'system',row.id,JSON.stringify({slug:input.slug})]);
  return row;
}

export async function listProducts(){return (await db().query('select * from products order by created_at desc')).rows;}

export async function setProductStatus(id:string,status:'active'|'disabled'|'archived',actorUserId?:string|null,actor?:string){const result=await db().query('update products set status=$1 where id=$2 returning *',[status,id]);if(!result.rowCount)throw new Error('Product not found');await db().query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'product.status','product',$3,$4)`,[actorUserId??null,actor??'system',id,JSON.stringify({status})]);return result.rows[0];}


export async function updateProduct(input:{id:string;name:string;slug:string;description?:string|null;actorUserId?:string|null;actor?:string}){
  const id=String(input.id||'').trim();
  const name=String(input.name||'').trim();
  const slug=normalizeProductSlug(input.slug);
  if(!id||!name||!slug)throw new Error('Product id, name and slug are required');
  if(!/^[a-z0-9][a-z0-9._-]*$/.test(slug))throw new Error('Invalid product slug');
  const before=(await db().query('select name,slug,description,status from products where id=$1 limit 1',[id])).rows[0];
  if(!before)throw new Error('Product not found');
  const row=(await db().query('update products set name=$1,slug=$2,description=$3,updated_at=now() where id=$4 returning *',[name,slug,input.description??null,id])).rows[0];
  await db().query(`insert into audit_events(actor_user_id,actor,action,resource_type,resource_id,details) values($1,$2,'product.update','product',$3,$4)`,[input.actorUserId??null,input.actor??'system',id,JSON.stringify({before,after:{name:row.name,slug:row.slug,description:row.description,status:row.status}})]);
  return row;
}
