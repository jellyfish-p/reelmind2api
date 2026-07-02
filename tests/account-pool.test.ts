import { beforeEach, describe, expect, it, vi } from 'vitest'

const poolState = vi.hoisted(() => ({
  accounts: [] as Array<Record<string, any>>,
  updates: [] as Array<Record<string, any>>,
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((column: any, value: unknown) => (row: any) =>
    row[column.key] === value,
  ),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}))

vi.mock('../server/db', () => {
  const schema = {
    accounts: {
      id: { key: 'id', name: 'id' },
      updatedAt: { key: 'updatedAt', name: 'updated_at' },
      creditsRemaining: { key: 'creditsRemaining', name: 'credits_remaining' },
    },
  }

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        all: vi.fn(() => poolState.accounts),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, any>) => ({
        where: vi.fn((predicate: (row: any) => boolean) => ({
          run: vi.fn(() => {
            poolState.updates.push(values)
            for (const row of poolState.accounts.filter(predicate)) {
              Object.assign(row, values)
            }
          }),
        })),
      })),
    })),
  }

  return {
    getDb: () => db,
    schema,
  }
})

describe('account pool rotation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    poolState.accounts = []
    poolState.updates = []
  })

  it('rotates across accounts whose token and remaining credits can cover the request', async () => {
    const now = new Date('2026-07-02T12:00:00Z').getTime()
    vi.setSystemTime(now)
    poolState.accounts = [
      account({ id: 1, accessToken: 'token-1', creditsRemaining: 1 }),
      account({ id: 2, accessToken: 'token-2', creditsRemaining: 3 }),
      account({ id: 3, accessToken: 'token-3', creditsRemaining: 10 }),
    ]

    const { reserveAccountForCredits } = await import('../server/utils/account-pool')

    expect(reserveAccountForCredits(2)?.id).toBe(2)
    expect(reserveAccountForCredits(2)?.id).toBe(3)
    expect(reserveAccountForCredits(2)?.id).toBe(3)
    expect(poolState.updates).toMatchObject([
      { creditsRemaining: 1, updatedAt: now },
      { creditsRemaining: 8, updatedAt: now },
      { creditsRemaining: 6, updatedAt: now },
    ])
  })

  it('returns null when every account is unavailable', async () => {
    poolState.accounts = [
      account({ id: 1, accessToken: '', creditsRemaining: 10 }),
      account({ id: 2, accessToken: 'token-2', tokenExpiresAt: Date.now() - 1000, creditsRemaining: 10 }),
      account({ id: 3, accessToken: 'token-3', creditsRemaining: 1 }),
    ]

    const { reserveAccountForCredits } = await import('../server/utils/account-pool')

    expect(reserveAccountForCredits(2)).toBeNull()
    expect(poolState.updates).toHaveLength(0)
  })
})

function account(overrides: Record<string, any>) {
  return {
    id: 0,
    email: 'account@example.test',
    accessToken: 'token',
    refreshToken: null,
    tokenExpiresAt: Date.now() + 60_000,
    creditsRemaining: null,
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  }
}
