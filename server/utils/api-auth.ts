import { getDb, schema } from '../db'
import { eq, sql } from 'drizzle-orm'
import { findApiKey } from './config'

export interface ApiKeyAuth {
  tokenId: number
  tokenKey: string
  tokenName: string
}

export async function authenticateApiKey(
  event: any,
  requestedUsage = 0,
): Promise<ApiKeyAuth | null> {
  const authHeader = getHeader(event, 'authorization')
  let key = ''
  if (authHeader?.startsWith('Bearer ')) {
    key = authHeader.slice(7)
  } else {
    key = getHeader(event, 'x-api-key') || ''
  }
  if (!key) return null

  const keyConfig = findApiKey(key)
  if (!keyConfig) return null

  const db = getDb()
  const now = Date.now()
  const quota = keyConfig.quota ?? 0
  const tokenConfigState = {
    name: keyConfig.name,
    quota,
    rateLimit: keyConfig.rate_limit ?? 60,
    enabled: 1,
  }

  let token = getApiTokenByKey(db, key)

  if (!token) {
    try {
      db.insert(schema.apiTokens)
        .values({
          key,
          ...tokenConfigState,
          used: 0,
          lastUsedAt: now,
          createdAt: now,
        })
        .run()
    } catch (err: any) {
      if (!isUniqueConstraintError(err)) throw err
    }

    token = getApiTokenByKey(db, key)
  }

  if (!token) return null

  db.update(schema.apiTokens)
    .set(tokenConfigState)
    .where(eq(schema.apiTokens.id, token.id))
    .run()
  token = { ...token, ...tokenConfigState }

  const usageToReserve = Math.max(0, requestedUsage)
  if (quota > 0) {
    const quotaExceeded = usageToReserve > 0
      ? token.used + usageToReserve > quota
      : token.used >= quota
    if (quotaExceeded) return null
  }

  db.update(schema.apiTokens)
    .set({ lastUsedAt: now })
    .where(eq(schema.apiTokens.id, token.id))
    .run()

  return {
    tokenId: token.id,
    tokenKey: key,
    tokenName: keyConfig.name,
  }
}

function getApiTokenByKey(db: any, key: string) {
  return db
    .select()
    .from(schema.apiTokens)
    .where(eq(schema.apiTokens.key, key))
    .get()
}

function isUniqueConstraintError(err: any): boolean {
  const message = String(err?.message || '')
  return err?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    (err?.code === 'SQLITE_CONSTRAINT' && message.includes('UNIQUE')) ||
    message.includes('UNIQUE constraint failed')
}

export async function incrementUsage(tokenId: number, amount: number) {
  const db = getDb()
  db.update(schema.apiTokens)
    .set({ used: sql`used + ${amount}` })
    .where(eq(schema.apiTokens.id, tokenId))
    .run()
}

export async function authenticateAdmin(event: any): Promise<boolean> {
  const key = getHeader(event, 'x-admin-key') || getQuery(event).admin_key || ''
  const { validateAdminKey } = await import('./config')
  return validateAdminKey(key as string)
}
