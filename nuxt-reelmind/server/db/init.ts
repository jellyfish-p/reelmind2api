import { existsSync, mkdirSync } from 'fs'
import { getDb, schema } from '../db'
import { eq } from 'drizzle-orm'

export async function initializeDatabase() {
  const db = getDb()
  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      google_sub TEXT UNIQUE,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      quota INTEGER NOT NULL DEFAULT 1000,
      used INTEGER NOT NULL DEFAULT 0,
      rate_limit INTEGER NOT NULL DEFAULT 60,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL UNIQUE,
      object TEXT NOT NULL DEFAULT 'task',
      model TEXT NOT NULL,
      type TEXT NOT NULL,
      prompt TEXT,
      negative_prompt TEXT,
      image_url TEXT,
      aspect_ratio TEXT,
      duration INTEGER,
      resolution TEXT,
      parameters TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      result_url TEXT,
      result_data TEXT,
      error_message TEXT,
      reelmind_task_id TEXT,
      api_token_id INTEGER REFERENCES api_tokens(id),
      account_id INTEGER REFERENCES accounts(id),
      credits_used REAL,
      poll_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `)
  await syncApiTokensFromConfig()
}

async function syncApiTokensFromConfig() {
  const db = getDb()
  const config = loadConfig()
  const keys = config.api_keys || []
  const now = Date.now()
  for (const k of keys) {
    const existing = db
      .select()
      .from(schema.apiTokens)
      .where(eq(schema.apiTokens.key, k.key))
      .get()
    if (!existing) {
      db.insert(schema.apiTokens).values({
        key: k.key,
        name: k.name,
        quota: k.quota || 10000,
        rateLimit: k.rate_limit || 60,
        enabled: 1,
        createdAt: now,
      }).run()
    } else {
      db.update(schema.apiTokens)
        .set({
          name: k.name,
          quota: k.quota || 10000,
          rateLimit: k.rate_limit || 60,
          enabled: k.enabled ? 1 : 0,
        })
        .where(eq(schema.apiTokens.key, k.key))
        .run()
    }
  }
}
