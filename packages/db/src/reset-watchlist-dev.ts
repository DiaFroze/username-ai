import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';
import { getDbPool, closeDbPool } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export async function resetWatchlistDev(): Promise<void> {
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv === 'production') {
    console.error('⛔ FATAL: Cannot run db:reset-watchlist-dev in production environment!');
    process.exit(1);
  }

  if (process.env.CONFIRM_DEV_RESET !== 'true') {
    console.error('⛔ Refused: db:reset-watchlist-dev requires explicit confirmation flag CONFIRM_DEV_RESET=true');
    process.exit(1);
  }

  console.log('⚠️  Resetting dev watchlist tables (notification_logs, watchlist_items)...');
  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    // ONLY clean watchlist and notification logs — never users, searches, platform_checks!
    await client.query('DELETE FROM "notification_logs";');
    await client.query('DELETE FROM "watchlist_items";');
    await client.query('COMMIT');
    console.log('✅ Development watchlist tables reset successfully. Users and search history preserved.');
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('❌ Reset failed:', err.message);
    throw err;
  } finally {
    client.release();
    await closeDbPool();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  resetWatchlistDev().catch(() => process.exit(1));
}
