import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../src/migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const originalDrizzleDir = path.resolve(__dirname, '../drizzle');

describe('Migration Ledger SHA-256 Checksum Validation', () => {
  it('1. Applies migrations and records valid 64-character SHA-256 checksums in _migrations', async () => {
    const db = new PGlite();

    const applied = await runMigrations({
      client: db,
      drizzleDir: originalDrizzleDir,
    });

    expect(applied.length).toBeGreaterThanOrEqual(3);
    expect(applied).toContain('0000_initial.sql');
    expect(applied).toContain('0001_watchlist.sql');
    expect(applied).toContain('0002_watchlist_integrity.sql');

    const res = await db.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM "_migrations" ORDER BY id ASC;'
    );

    expect(res.rows.length).toBe(applied.length);
    for (const row of res.rows) {
      expect(row.checksum).toBeDefined();
      expect(row.checksum.trim().length).toBe(64); // SHA-256 hex length
    }
  });

  it('2. Subsequent run is completely idempotent and skips already applied migrations with matching checksums', async () => {
    const db = new PGlite();

    await runMigrations({ client: db, drizzleDir: originalDrizzleDir });

    // Second run
    const secondApplied = await runMigrations({
      client: db,
      drizzleDir: originalDrizzleDir,
    });

    expect(secondApplied.length).toBe(0);
  });

  it('3. Throws Migration integrity violation when an applied migration file is modified', async () => {
    const db = new PGlite();

    // Create a temporary drizzle directory with mock migration files
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-tamper-'));
    try {
      const file1 = path.join(tempDir, '0000_test.sql');
      fs.writeFileSync(file1, 'CREATE TABLE test_table (id serial PRIMARY KEY);', 'utf8');

      // 1. First run applies cleanly
      const applied = await runMigrations({ client: db, drizzleDir: tempDir });
      expect(applied).toEqual(['0000_test.sql']);

      // 2. Tamper with the migration file content
      fs.writeFileSync(file1, 'CREATE TABLE test_table (id serial PRIMARY KEY, tampered text);', 'utf8');

      // 3. Second run must detect checksum mismatch and throw
      await expect(
        runMigrations({ client: db, drizzleDir: tempDir })
      ).rejects.toThrow(/Migration integrity violation/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
