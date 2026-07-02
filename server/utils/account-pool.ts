import { eq, sql } from 'drizzle-orm'
import { getDb, schema } from '../db'
import type { Account } from '../db/schema'

let nextAccountIndex = 0

export function reserveAccountForCredits(
  requiredCredits: number,
  now = Date.now(),
): Account | null {
  const db = getDb()
  const accounts = db.select().from(schema.accounts).all()
  if (!accounts.length) return null

  const cost = normalizedRequiredCredits(requiredCredits)
  const startIndex = nextAccountIndex % accounts.length

  for (let offset = 0; offset < accounts.length; offset++) {
    const index = (startIndex + offset) % accounts.length
    const account = accounts[index]
    if (!isAccountAvailable(account, cost, now)) continue

    nextAccountIndex = (index + 1) % accounts.length
    reserveKnownCredits(db, account, cost, now)
    return account
  }

  return null
}

export function isAccountAvailable(
  account: Pick<Account, 'accessToken' | 'tokenExpiresAt' | 'creditsRemaining'>,
  requiredCredits: number,
  now = Date.now(),
): boolean {
  if (!account.accessToken) return false
  if (
    typeof account.tokenExpiresAt === 'number' &&
    account.tokenExpiresAt < now
  ) {
    return false
  }

  const remaining = normalizeKnownCredits(account.creditsRemaining)
  return remaining === null || remaining >= normalizedRequiredCredits(requiredCredits)
}

export function refundReservedCredits(
  accountId: number,
  reservedCredits: number,
  now = Date.now(),
) {
  const credits = normalizedRequiredCredits(reservedCredits)
  if (!Number.isInteger(accountId) || accountId <= 0 || credits <= 0) return

  const db = getDb()
  db.update(schema.accounts)
    .set({
      creditsRemaining: sql`${schema.accounts.creditsRemaining} + ${credits}`,
      updatedAt: now,
    })
    .where(eq(schema.accounts.id, accountId))
    .run()
}

function reserveKnownCredits(db: any, account: Account, cost: number, now: number) {
  const remaining = normalizeKnownCredits(account.creditsRemaining)
  if (remaining === null) return

  db.update(schema.accounts)
    .set({
      creditsRemaining: remaining - cost,
      updatedAt: now,
    })
    .where(eq(schema.accounts.id, account.id))
    .run()
}

function normalizedRequiredCredits(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

function normalizeKnownCredits(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const credits = Number(value)
  return Number.isFinite(credits) ? credits : null
}
