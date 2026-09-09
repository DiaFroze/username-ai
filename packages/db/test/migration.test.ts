import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.resolve(__dirname, '../drizzle');

describe('Database Migration Matrix Audit', () => {
  const readMigration = (filename: string) =>
    fs.readFileSync(path.join(drizzleDir, filename), 'utf8');

  // Scenario A: Clean Database (0000 -> 0001 -> 0002)
  it('Scenario A: Successfully applies full migration chain (0000 -> 0001 -> 0002) on a clean database', async () => {
    const db = new PGlite();

    // 1. Initial schema
    await db.exec(readMigration('0000_initial.sql'));

    // 2. Watchlist Phase 1D schema
    await db.exec(readMigration('0001_watchlist.sql'));

    // 3. Watchlist Integrity Phase 1D.1 schema
    await db.exec(readMigration('0002_watchlist_integrity.sql'));

    // Verify all expected tables exist
    const tablesRes = await db.query<{ tablename: string }>(`
      SELECT tablename FROM pg_catalog.pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename ASC;
    `);
    const tables = tablesRes.rows.map((r) => r.tablename);
    expect(tables).toContain('users');
    expect(tables).toContain('searches');
    expect(tables).toContain('platform_checks');
    expect(tables).toContain('watchlist_items');
    expect(tables).toContain('notification_logs');

    // Verify columns on watchlist_items match the new Phase 1D.1 / 1E schema
    const colsRes = await db.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'watchlist_items';
    `);
    const cols = colsRes.rows.map((r) => r.column_name);
    expect(cols).toContain('current_status');
    expect(cols).toContain('previous_status');
    expect(cols).toContain('check_interval_minutes');
    expect(cols).toContain('consecutive_errors');
    expect(cols).toContain('consecutive_stable_count');
    expect(cols).toContain('status_version');
    expect(cols).toContain('metadata');

    // Ensure deprecated columns are gone
    expect(cols).not.toContain('check_interval_seconds');
    expect(cols).not.toContain('last_status');
    expect(cols).not.toContain('consecutive_failures');
  });

  // Scenario B: Upgrade Database from 0001 with existing data
  it('Scenario B: Safely upgrades 0001 database with existing data to 0002 without data loss', async () => {
    const db = new PGlite();

    // Set up DB at state 0001
    await db.exec(readMigration('0000_initial.sql'));
    await db.exec(readMigration('0001_watchlist.sql'));

    // Insert pre-existing user
    await db.query(`
      INSERT INTO users (id, telegram_id, first_name, username, tier)
      VALUES ('a0000000-0000-0000-0000-000000000001', 99999999, 'Tester', 'testuser', 'FREE');
    `);

    // Insert pre-existing search and check
    await db.query(`
      INSERT INTO searches (id, user_id, query)
      VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'novexa');
    `);

    await db.query(`
      INSERT INTO platform_checks (id, search_id, platform, username, status, confidence, source, response_time_ms)
      VALUES ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'TELEGRAM', 'novexa', 'TAKEN', 1.0, 'MOCK', 20);
    `);

    // Insert pre-existing watchlist_items using 0001 columns (last_status, check_interval_seconds, consecutive_failures)
    await db.query(`
      INSERT INTO watchlist_items (
        id, user_id, platform, target, last_status, last_confidence, check_interval_seconds, consecutive_failures, is_active
      ) VALUES (
        'd0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001',
        'TELEGRAM',
        'novexa',
        'TAKEN',
        0.95,
        21600,
        2,
        true
      );
    `);

    // Insert pre-existing notification log
    await db.query(`
      INSERT INTO notification_logs (
        id, watchlist_item_id, user_id, event_type, old_status, new_status, status, idempotency_key
      ) VALUES (
        'e0000000-0000-0000-0000-000000000001',
        'd0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001',
        'STATUS_CHANGED_TAKEN',
        'UNKNOWN',
        'TAKEN',
        'DELIVERED',
        'notify:d0000000-0000-0000-0000-000000000001:old_key_1'
      );
    `);

    // Execute migration 0002 on populated database
    await db.exec(readMigration('0002_watchlist_integrity.sql'));

    // 1. Verify users table is completely preserved
    const usersRes = await db.query<{ username: string; telegram_id: string }>(
      'SELECT username, telegram_id FROM users WHERE id = $1',
      ['a0000000-0000-0000-0000-000000000001']
    );
    expect(usersRes.rows.length).toBe(1);
    expect(usersRes.rows[0].username).toBe('testuser');

    // 2. Verify searches and platform_checks are preserved
    const searchesRes = await db.query('SELECT query FROM searches;');
    expect(searchesRes.rows.length).toBe(1);

    const checksRes = await db.query('SELECT platform FROM platform_checks;');
    expect(checksRes.rows.length).toBe(1);

    // 3. Verify watchlist item was migrated non-destructively:
    // - last_status -> current_status ('TAKEN')
    // - check_interval_seconds (21600) -> check_interval_minutes (360)
    // - consecutive_failures (2) -> consecutive_errors (2)
    // - status_version default (1)
    const watchRes = await db.query<{
      current_status: string;
      check_interval_minutes: number;
      consecutive_errors: number;
      status_version: number;
      target: string;
    }>(
      'SELECT current_status, check_interval_minutes, consecutive_errors, status_version, target FROM watchlist_items WHERE id = $1',
      ['d0000000-0000-0000-0000-000000000001']
    );
    expect(watchRes.rows.length).toBe(1);
    const item = watchRes.rows[0];
    expect(item.current_status).toBe('TAKEN');
    expect(item.check_interval_minutes).toBe(360);
    expect(item.consecutive_errors).toBe(2);
    expect(item.status_version).toBe(1);
    expect(item.target).toBe('novexa');

    // 4. Verify notification log is preserved and has status_version
    const notifRes = await db.query<{ status_version: number; status: string }>(
      'SELECT status_version, status FROM notification_logs WHERE id = $1',
      ['e0000000-0000-0000-0000-000000000001']
    );
    expect(notifRes.rows.length).toBe(1);
    expect(notifRes.rows[0].status_version).toBe(1);
    expect(notifRes.rows[0].status).toBe('DELIVERED');
  });

  // Scenario C: Idempotency of 0002
  it('Scenario C: Re-applying 0002 on an already upgraded database is completely idempotent', async () => {
    const db = new PGlite();
    await db.exec(readMigration('0000_initial.sql'));
    await db.exec(readMigration('0001_watchlist.sql'));
    await db.exec(readMigration('0002_watchlist_integrity.sql'));

    // Re-run 0002
    await expect(db.exec(readMigration('0002_watchlist_integrity.sql'))).resolves.toBeDefined();
  });
});
