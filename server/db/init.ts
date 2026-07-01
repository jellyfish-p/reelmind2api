import { getDb } from '../db'

export async function initializeDatabase() {
  const db = getDb()
  const statements = [
    `
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      google_sub TEXT UNIQUE,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at INTEGER,
      cookie_part_0 TEXT,
      cookie_part_1 TEXT,
      authorization_header TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
    `,
    `
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
    )
    `,
    `
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
    )
    `,
  ]

  for (const statement of statements) {
    db.run(statement)
  }

  ensureColumn(db, 'accounts', 'cookie_part_0', 'TEXT')
  ensureColumn(db, 'accounts', 'cookie_part_1', 'TEXT')
  ensureColumn(db, 'accounts', 'authorization_header', 'TEXT')
}

function ensureColumn(db: any, table: string, column: string, type: string) {
  try {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  } catch (error: any) {
    const message = String(error?.message || '')
    if (!message.toLowerCase().includes('duplicate column')) {
      throw error
    }
  }
}
