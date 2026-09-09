import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let dbInstance: NodePgDatabase<typeof schema> | null = null;

export function getDbPool(connectionString?: string): pg.Pool {
  if (!pool) {
    const url = connectionString || process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not defined in environment variables');
    }
    pool = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

export function getDb(connectionString?: string): NodePgDatabase<typeof schema> {
  if (!dbInstance) {
    const p = getDbPool(connectionString);
    dbInstance = drizzle(p, { schema });
  }
  return dbInstance;
}

export interface DatabaseHealth {
  status: 'UP' | 'DOWN';
  latencyMs?: number;
  error?: string;
}

export async function checkDatabaseHealth(connectionString?: string): Promise<DatabaseHealth> {
  const start = Date.now();
  try {
    const p = getDbPool(connectionString);
    const client = await p.connect();
    try {
      await client.query('SELECT 1');
      return {
        status: 'UP',
        latencyMs: Date.now() - start,
      };
    } finally {
      client.release();
    }
  } catch (err: any) {
    return {
      status: 'DOWN',
      latencyMs: Date.now() - start,
      error: err.message,
    };
  }
}

export function setDbInstance(customDb: NodePgDatabase<typeof schema> | any): void {
  dbInstance = customDb;
}

export async function closeDbPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  dbInstance = null;
}
