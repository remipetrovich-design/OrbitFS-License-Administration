import { Pool } from 'pg';

let pool: Pool | undefined;

function connectionString() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not configured');
  try {
    const url = new URL(raw);
    if (url.hostname.startsWith('db.') && url.hostname.endsWith('.supabase.co')) {
      const ref = url.hostname.slice(3, -'.supabase.co'.length);
      const poolerHost = process.env.SUPABASE_POOLER_HOST || 'aws-0-ap-southeast-2.pooler.supabase.com';
      url.hostname = poolerHost;
      url.port = '6543';
      if (url.username === 'postgres') url.username = `postgres.${ref}`;
      return url.toString();
    }
  } catch {}
  return raw;
}

export function db() {
  if (!pool) {
    pool = new Pool({
      connectionString: connectionString(),
      max: 5,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}
