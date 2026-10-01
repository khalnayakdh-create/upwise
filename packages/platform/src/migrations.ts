import type { D1Database } from "@cloudflare/workers-types";
/**
 * Minimal, idempotent migration runner for Cloudflare D1.
 *
 * Why in-Worker: Wrangler can auto-provision the D1 database on first deploy,
 * but `wrangler d1 migrations apply` does not support auto-provisioned
 * bindings. Running migrations from the Worker keeps deploys one-step
 * (push to GitHub -> Workers Builds deploys -> first request migrates).
 *
 * Rules: never edit a shipped migration; append a new one.
 */
export interface Migration {
  id: number;
  name: string;
  sql: string[];
}

export const platformMigrations: Migration[] = [
  {
    id: 1,
    name: "create_session",
    sql: [
      `CREATE TABLE IF NOT EXISTS session (
        id TEXT PRIMARY KEY NOT NULL,
        shop TEXT NOT NULL,
        state TEXT NOT NULL,
        isOnline INTEGER NOT NULL DEFAULT 0,
        scope TEXT,
        expires TEXT,
        accessToken TEXT,
        userId BLOB,
        firstName TEXT,
        lastName TEXT,
        email TEXT,
        accountOwner INTEGER,
        locale TEXT,
        collaborator INTEGER,
        emailVerified INTEGER,
        refreshToken TEXT,
        refreshTokenExpires TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS session_shop_idx ON session (shop)`,
    ],
  },
  {
    id: 2,
    name: "create_shop_compliance_webhooks",
    sql: [
      `CREATE TABLE IF NOT EXISTS shop (
        shop TEXT PRIMARY KEY NOT NULL,
        installed_at TEXT NOT NULL,
        uninstalled_at TEXT,
        plan TEXT NOT NULL DEFAULT 'free'
      )`,
      `CREATE TABLE IF NOT EXISTS compliance_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop TEXT NOT NULL,
        topic TEXT NOT NULL,
        webhook_id TEXT,
        received_at TEXT NOT NULL,
        completed_at TEXT,
        note TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS processed_webhook (
        webhook_id TEXT PRIMARY KEY NOT NULL,
        topic TEXT NOT NULL,
        shop TEXT NOT NULL,
        processed_at TEXT NOT NULL
      )`,
    ],
  },
];

const applied = new WeakMap<D1Database, Promise<number[]>>();

/** Apply pending migrations once per isolate. Returns IDs applied this call. */
export function ensureMigrated(
  db: D1Database,
  migrations: Migration[] = platformMigrations,
): Promise<number[]> {
  let pending = applied.get(db);
  if (!pending) {
    pending = runMigrations(db, migrations).catch((error) => {
      applied.delete(db); // retry on next request
      throw error;
    });
    applied.set(db, pending);
  }
  return pending;
}

export async function runMigrations(
  db: D1Database,
  migrations: Migration[] = platformMigrations,
): Promise<number[]> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )`,
    )
    .run();

  const { results } = await db
    .prepare(`SELECT id FROM _migrations`)
    .all<{ id: number }>();
  const done = new Set(results.map((r) => r.id));
  const newlyApplied: number[] = [];

  for (const migration of [...migrations].sort((a, b) => a.id - b.id)) {
    if (done.has(migration.id)) continue;
    const record = db
      .prepare(`INSERT OR IGNORE INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)`)
      .bind(migration.id, migration.name, new Date().toISOString());
    try {
      // D1 batch() runs statements in a single transaction.
      await db.batch([...migration.sql.map((statement) => db.prepare(statement)), record]);
    } catch (error) {
      // Another isolate may have applied it concurrently (e.g. ALTER TABLE ADD COLUMN
      // fails with "duplicate column name" for the loser). Treat that as applied.
      const applied = await db
        .prepare(`SELECT 1 AS ok FROM _migrations WHERE id = ?`)
        .bind(migration.id)
        .first<{ ok: number }>();
      if (applied) continue;
      if (String(error).includes("duplicate column name")) {
        await record.run();
        continue;
      }
      throw error;
    }
    newlyApplied.push(migration.id);
  }
  return newlyApplied;
}
