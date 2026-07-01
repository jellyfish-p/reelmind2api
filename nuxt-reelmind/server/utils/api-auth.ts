import { getDb, schema } from '../db'
import { eq, and, sql } from 'drizzle-orm'
import { findApiKey } from './config'

export interface ApiKeyAuth {
  tokenId: number
  tokenKey: string
  tokenName: string
}

export async function authenticateApiKey(event: any): Promise<ApiKeyAuth | null> {
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
  const token = db
    .select()
    .from(schema.apiTokens)
    .where(
      and(eq(schema.apiTokens.key, key), eq(schema.apiTokens.enabled, 1)),
    )
    .get()

  if (!token) return null

  if (token.quota > 0 && token.used >= token.quota) return null

  db.update(schema.apiTokens)
    .set({ lastUsedAt: now })
    .where(eq(schema.apiTokens.id, token.id))
    .run()

  return {
    tokenId: token.id,
    tokenKey: token.key,
    tokenName: token.name,
  }
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
