import { db } from '../db';

export function normalizeProductSlug(value:string){const slug=String(value||'').trim().toLowerCase();return slug==='orbitfs'?'orbitfs_base':slug;}

export async function listProducts(){return (await db().query('select * from products order by created_at desc')).rows;}
