import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

let _db: ReturnType<typeof drizzle> | null = null
let _sqlite: Database.Database | null = null

export function getDbPath(): string {
  const config = useAppConfig()
  return (config.database?.path as string) || './data/reelmind.db'
}

export function getDb() {
  if (_db) return _db
  const dbPath = getDbPath()
  const dir = dirname(dbPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  _sqlite = new Database(dbPath)
  _sqlite.pragma('journal_mode = WAL')
  _sqlite.pragma('foreign_keys = ON')
  _db = drizzle(_sqlite, { schema })
  return _db
}

export function closeDb() {
  _sqlite?.close()
  _sqlite = null
  _db = null
}

export { schema }
