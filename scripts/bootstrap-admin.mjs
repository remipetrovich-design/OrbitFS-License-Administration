import crypto from 'node:crypto';
import pg from 'pg';
const { Pool } = pg;
const email=(process.env.BOOTSTRAP_ADMIN_EMAIL||'').trim().toLowerCase();
const password=process.env.BOOTSTRAP_ADMIN_PASSWORD||'';
if(!process.env.DATABASE_URL||!email||!password){console.error('DATABASE_URL, BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required');process.exit(1);}
if(password.length<12){console.error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters');process.exit(1);}
const salt=crypto.randomBytes(16).toString('hex');
const hash=crypto.scryptSync(password,salt,64).toString('hex');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false}});
await pool.query(`insert into users(email,password_hash,password_salt,display_name,role,status) values($1,$2,$3,$4,'owner','active') on conflict(email) do update set password_hash=excluded.password_hash,password_salt=excluded.password_salt,status='active',role='owner'`,[email,hash,salt,'Administrator']);
console.log(`Owner account ready: ${email}`);
await pool.end();
