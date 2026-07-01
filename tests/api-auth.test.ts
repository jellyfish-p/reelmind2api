import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '../server/db/init'
import { authenticateApiKey, incrementUsage } from '../server/utils/api-auth'

const mockState = vi.hoisted(() => ({
  configKeys: [] as Array<{
    key: string
    name: string
    quota: number
    rate_limit: number
    enabled?: boolean
  }>,
  nextId: 1,
  tokens: [] as Array<Record<string, any>>,
  insertError: null as Error | null,
  insertRaceToken: null as Record<string, any> | null,
  schemaRuns: [] as string[],
}))

vi.mock('drizzle-orm', () => ({
  and:
    (...conditions: Array<(row: Record<string, any>) => boolean>) =>
    (row: Record<string, any>) =>
      conditions.every((condition) => condition(row)),
  eq:
    (column: { name: string }, value: unknown) =>
    (row: Record<string, any>) =>
      row[column.name] === value,
  sql: (_strings: TemplateStringsArray, amount: number) => ({
    __incrementBy: amount,
  }),
}))

vi.mock('../server/utils/config', () => ({
  findApiKey: vi.fn((key: string) =>
    mockState.configKeys.find(
      (configKey) => configKey.key === key && configKey.enabled !== false,
    ),
  ),
}))

vi.mock('../server/db', () => {
  const schema = {
    apiTokens: {
      id: { name: 'id' },
      key: { name: 'key' },
      enabled: { name: 'enabled' },
    },
  }

  const getMatchingRows = (
    predicate: ((row: Record<string, any>) => boolean) | undefined,
  ) => mockState.tokens.filter((token) => !predicate || predicate(token))

  const db = {
    run: vi.fn((sql: string) => {
      mockState.schemaRuns.push(sql)
      const statements = sql
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean)
      if (statements.length > 1) {
        throw new Error('The supplied SQL string contains more than one statement')
      }
    }),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, any>) => ({
        run: vi.fn(() => {
          if (mockState.insertError) {
            if (mockState.insertRaceToken) {
              mockState.tokens.push(mockState.insertRaceToken)
            }
            const err = mockState.insertError
            mockState.insertError = null
            mockState.insertRaceToken = null
            throw err
          }
          const row = {
            id: mockState.nextId++,
            used: 0,
            ...values,
          }
          mockState.tokens.push(row)
          return { lastInsertRowid: row.id }
        }),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        get: vi.fn(() => mockState.tokens[0]),
        where: vi.fn((predicate: (row: Record<string, any>) => boolean) => ({
          get: vi.fn(() => getMatchingRows(predicate)[0]),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, any>) => ({
        where: vi.fn((predicate: (row: Record<string, any>) => boolean) => ({
          run: vi.fn(() => {
            for (const row of getMatchingRows(predicate)) {
              for (const [key, value] of Object.entries(values)) {
                if (
                  value &&
                  typeof value === 'object' &&
                  '__incrementBy' in value
                ) {
                  row[key] = (row[key] || 0) + value.__incrementBy
                } else {
                  row[key] = value
                }
              }
            }
          }),
        })),
      })),
    })),
  }

  return { getDb: () => db, schema }
})

describe('API key authentication', () => {
  beforeEach(() => {
    mockState.configKeys = []
    mockState.nextId = 1
    mockState.tokens = []
    mockState.insertError = null
    mockState.insertRaceToken = null
    mockState.schemaRuns = []
    vi.stubGlobal('getHeader', (event: any, name: string) => {
      const headers = event.headers || {}
      return headers[name] ?? headers[name.toLowerCase()] ?? null
    })
  })

  it('authenticates an enabled config bearer key without a pre-existing token row', async () => {
    mockState.configKeys = [
      {
        key: 'enabled-config-key',
        name: 'Enabled Config Key',
        quota: 100,
        rate_limit: 30,
        enabled: true,
      },
    ]

    const result = await authenticateApiKey({
      headers: { authorization: 'Bearer enabled-config-key' },
    })

    expect(result).toEqual({
      tokenId: 1,
      tokenKey: 'enabled-config-key',
      tokenName: 'Enabled Config Key',
    })
    expect(mockState.tokens).toHaveLength(1)
    expect(mockState.tokens[0]).toMatchObject({
      id: 1,
      key: 'enabled-config-key',
      name: 'Enabled Config Key',
      quota: 100,
      rateLimit: 30,
      enabled: 1,
      used: 0,
    })
    expect(mockState.tokens[0].lastUsedAt).toEqual(expect.any(Number))
  })

  it('authenticates x-api-key from config and refreshes existing token state', async () => {
    mockState.configKeys = [
      {
        key: 'x-header-key',
        name: 'X Header Key',
        quota: 50,
        rate_limit: 20,
        enabled: true,
      },
    ]
    mockState.tokens = [
      {
        id: 7,
        key: 'x-header-key',
        name: 'Stale Name',
        quota: 1,
        used: 0,
        rateLimit: 1,
        enabled: 0,
        createdAt: 123,
      },
    ]

    const result = await authenticateApiKey({
      headers: { 'x-api-key': 'x-header-key' },
    })

    expect(result).toEqual({
      tokenId: 7,
      tokenKey: 'x-header-key',
      tokenName: 'X Header Key',
    })
    expect(mockState.tokens[0]).toMatchObject({
      name: 'X Header Key',
      quota: 50,
      rateLimit: 20,
      enabled: 1,
    })
    expect(mockState.tokens[0].lastUsedAt).toEqual(expect.any(Number))
  })

  it('rejects disabled, unconfigured, and missing API keys', async () => {
    mockState.configKeys = [
      {
        key: 'disabled-key',
        name: 'Disabled Key',
        quota: 100,
        rate_limit: 30,
        enabled: false,
      },
    ]

    await expect(
      authenticateApiKey({ headers: { authorization: 'Bearer disabled-key' } }),
    ).resolves.toBeNull()
    await expect(
      authenticateApiKey({ headers: { authorization: 'Bearer unknown-key' } }),
    ).resolves.toBeNull()
    await expect(authenticateApiKey({ headers: {} })).resolves.toBeNull()
    expect(mockState.tokens).toHaveLength(0)
  })

  it('rejects an existing token whose used amount reaches the config quota', async () => {
    mockState.configKeys = [
      {
        key: 'quota-key',
        name: 'Quota Key',
        quota: 5,
        rate_limit: 60,
        enabled: true,
      },
    ]
    mockState.tokens = [
      {
        id: 3,
        key: 'quota-key',
        name: 'Quota Key',
        quota: 999,
        used: 5,
        rateLimit: 60,
        enabled: 1,
        createdAt: 456,
      },
    ]

    await expect(
      authenticateApiKey({ headers: { authorization: 'Bearer quota-key' } }),
    ).resolves.toBeNull()
  })

  it('rejects a request whose reserved usage would exceed the config quota', async () => {
    mockState.configKeys = [
      {
        key: 'costly-key',
        name: 'Costly Key',
        quota: 10,
        rate_limit: 60,
        enabled: true,
      },
    ]
    mockState.tokens = [
      {
        id: 9,
        key: 'costly-key',
        name: 'Costly Key',
        quota: 10,
        used: 9,
        rateLimit: 60,
        enabled: 1,
        createdAt: 456,
      },
    ]

    await expect(
      authenticateApiKey(
        { headers: { authorization: 'Bearer costly-key' } },
        3,
      ),
    ).resolves.toBeNull()
  })

  it('reselects the token row when lazy creation loses a unique-key race', async () => {
    mockState.configKeys = [
      {
        key: 'raced-key',
        name: 'Raced Key',
        quota: 100,
        rate_limit: 45,
        enabled: true,
      },
    ]
    mockState.insertError = Object.assign(
      new Error('UNIQUE constraint failed: api_tokens.key'),
      { code: 'SQLITE_CONSTRAINT_UNIQUE' },
    )
    mockState.insertRaceToken = {
      id: 23,
      key: 'raced-key',
      name: 'Raced Key',
      quota: 100,
      used: 0,
      rateLimit: 45,
      enabled: 1,
      createdAt: 123,
    }

    const result = await authenticateApiKey({
      headers: { authorization: 'Bearer raced-key' },
    })

    expect(result).toEqual({
      tokenId: 23,
      tokenKey: 'raced-key',
      tokenName: 'Raced Key',
    })
    expect(mockState.tokens).toHaveLength(1)
    expect(mockState.tokens[0].lastUsedAt).toEqual(expect.any(Number))
  })

  it('increments usage by token id', async () => {
    mockState.tokens = [
      {
        id: 11,
        key: 'usage-key',
        name: 'Usage Key',
        quota: 100,
        used: 2,
        rateLimit: 60,
        enabled: 1,
        createdAt: 789,
      },
    ]

    await incrementUsage(11, 4)

    expect(mockState.tokens[0].used).toBe(6)
  })

  it('initializes schema without syncing configured API keys into the database', async () => {
    mockState.configKeys = [
      {
        key: 'config-only-key',
        name: 'Config Only Key',
        quota: 100,
        rate_limit: 60,
        enabled: true,
      },
    ]

    await initializeDatabase()

    expect(mockState.tokens).toHaveLength(0)
  })

  it('runs each schema statement separately for better-sqlite3', async () => {
    await initializeDatabase()

    expect(mockState.schemaRuns).toHaveLength(3)
    expect(mockState.schemaRuns).toEqual([
      expect.stringContaining('CREATE TABLE IF NOT EXISTS accounts'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS api_tokens'),
      expect.stringContaining('CREATE TABLE IF NOT EXISTS tasks'),
    ])
  })
})
