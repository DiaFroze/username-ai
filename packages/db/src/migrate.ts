import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';
import { getDbPool, closeDbPool } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export interface MigrationOptions {
  drizzleDir?: string;
  client?: any;
  databaseUrl?: string;
  closePoolOnFinish?: boolean;
}

export async function runMigrations(options?: MigrationOptions): Promise<string[]> {
  const drizzleDir = options?.drizzleDir || path.resolve(__dirname, '../drizzle');
  const appliedMigrations: string[] = [];

  const externalClient = options?.client;
  const pool = externalClient ? null : getDbPool(options?.databaseUrl);
  const client = externalClient || (await pool!.connect());

  try {
    // 1. Ensure migrations ledger table exists with checksum tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_migrations" (
        "id" serial PRIMARY KEY,
        "name" varchar(255) NOT NULL UNIQUE,
        "checksum" char(64),
        "applied_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);
    await client.query(`
      ALTER TABLE "_migrations" ADD COLUMN IF NOT EXISTS "checksum" char(64);
    `);

    // 2. Fetch already applied migrations and their recorded checksums
    const res = await client.query('SELECT "name", "checksum" FROM "_migrations" ORDER BY "id" ASC;');
    const appliedMap = new Map<string, string | null>(
      res.rows.map((r: any) => [r.name, r.checksum || null])
    );

    // 3. Find and sort all .sql migration files
    const allFiles = fs
      .readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of allFiles) {
      const sqlContent = fs.readFileSync(path.join(drizzleDir, file), 'utf8');
      const fileChecksum = crypto.createHash('sha256').update(sqlContent).digest('hex');

      if (appliedMap.has(file)) {
        const recordedChecksum = appliedMap.get(file);
        if (recordedChecksum && recordedChecksum !== fileChecksum) {
          throw new Error(
            `Migration integrity violation for "${file}": calculated checksum ${fileChecksum} does not match recorded checksum ${recordedChecksum}. Applied migration file has been tampered with or modified!`
          );
        }
        if (!recordedChecksum) {
          // Backfill checksum for historical migrations applied before ledger checksum tracking
          await client.query('UPDATE "_migrations" SET "checksum" = $1 WHERE "name" = $2;', [fileChecksum, file]);
        }
        continue;
      }

      console.log(`🔄 Applying migration: ${file}...`);

      await client.query('BEGIN');
      try {
        if (typeof client.exec === 'function') {
        await client.exec(sqlContent);
      } else {
        await client.query(sqlContent);
      }
        await client.query('INSERT INTO "_migrations" ("name", "checksum") VALUES ($1, $2);', [file, fileChecksum]);
        await client.query('COMMIT');
        appliedMigrations.push(file);
        console.log(`✅ Applied migration: ${file} (sha256: ${fileChecksum.substring(0, 8)}...)`);
      } catch (err: any) {
        await client.query('ROLLBACK');
        console.error(`❌ Migration ${file} failed:`, err.message);
        throw err;
      }
    }

    if (appliedMigrations.length === 0) {
      console.log('✨ Database schema is up to date. No new migrations.');
    } else {
      console.log(`🎉 Successfully applied ${appliedMigrations.length} migration(s).`);
    }

    return appliedMigrations;
  } finally {
    if (!externalClient) {
      client.release();
      if (options?.closePoolOnFinish) {
        await closeDbPool();
      }
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations({ closePoolOnFinish: true })
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
