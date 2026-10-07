import { Pool } from 'pg';

let pool: Pool | undefined;

function connectionString() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not configured');

  try {
    const url = new URL(raw);
    const directSupabase = url.hostname.startsWith('db.') && url.hostname.endsWith('.supabase.co');
    const supabasePooler = url.hostname.endsWith('.pooler.supabase.com');

    if (directSupabase) {
      const ref = url.hostname.slice(3, -'.supabase.co'.length);
      const poolerHost = String(process.env.SUPABASE_POOLER_HOST || '').trim();
      if (!poolerHost) {
        throw new Error('SUPABASE_POOLER_HOST is required when DATABASE_URL uses a direct Supabase database host');
      }
      url.hostname = poolerHost;
      url.port = '6543';
      if (url.username === 'postgres') url.username = `postgres.${ref}`;
      url.searchParams.set('pgbouncer', 'true');
      return url.toString();
    }

    if (supabasePooler) {
      // Vercel/serverless traffic must use the transaction pooler. Port 5432 is
      // Supabase session mode and can exhaust the small per-project session pool.
      url.port = '6543';
      url.searchParams.set('pgbouncer', 'true');
      return url.toString();
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('SUPABASE_POOLER_HOST is required')) throw error;
    // Let pg report an invalid DATABASE_URL rather than hiding configuration errors.
  }
  return raw;
}

export function db() {
  if (!pool) {
    pool = new Pool({
      connectionString: connectionString(),
      max: Math.max(1, Number(process.env.DB_POOL_MAX || 2)),
      min: 0,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
      lock_timeout: 5_000,
      idle_in_transaction_session_timeout: 30_000,
      maxLifetimeSeconds: 300,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}
