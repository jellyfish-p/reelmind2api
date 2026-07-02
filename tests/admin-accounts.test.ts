import { beforeEach, describe, expect, it, vi } from 'vitest'

type RouteHandler = (event: any) => Promise<unknown>

const state = vi.hoisted(() => ({
  validAdmin: true,
  nextId: 2,
  accounts: [] as Array<Record<string, any>>,
  tasks: [] as Array<Record<string, any>>,
  inTransaction: false,
  transactionCalls: 0,
  operations: [] as Array<Record<string, any>>,
  failInsert: false,
  failSelect: false,
}))

vi.mock('../server/utils/api-auth', () => ({
  authenticateAdmin: vi.fn(async () => state.validAdmin),
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((column: any, value: any) => (row: any) => row[column.key] === value),
}))

vi.mock('../server/db', () => {
  const schema = {
    accounts: {
      id: { key: 'id' },
      email: { key: 'email' },
      googleSub: { key: 'googleSub' },
    },
    tasks: {
      accountId: { key: 'accountId' },
    },
  }

  function rowsFor(table: any) {
    if (state.failSelect) throw new Error('database read path leaked')
    if (table === schema.accounts) return state.accounts
    if (table === schema.tasks) return state.tasks
    return []
  }

  function tableName(table: any) {
    if (table === schema.accounts) return 'accounts'
    if (table === schema.tasks) return 'tasks'
    return 'unknown'
  }

  function uniqueConstraintError(column: 'email' | 'google_sub') {
    return Object.assign(
      new Error(`UNIQUE constraint failed: accounts.${column}`),
      { code: 'SQLITE_CONSTRAINT_UNIQUE' },
    )
  }

  function assertUniqueAccount(values: Record<string, any>, ignoredId?: number) {
    if (
      values.email !== undefined &&
      state.accounts.some(
        (account) => account.id !== ignoredId && account.email === values.email,
      )
    ) {
      throw uniqueConstraintError('email')
    }
    if (
      values.googleSub !== undefined &&
      values.googleSub !== null &&
      state.accounts.some(
        (account) =>
          account.id !== ignoredId && account.googleSub === values.googleSub,
      )
    ) {
      throw uniqueConstraintError('google_sub')
    }
  }

  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: any) => ({
        all: vi.fn(() => rowsFor(table)),
        where: vi.fn((predicate: (row: any) => boolean) => ({
          get: vi.fn(() => rowsFor(table).find(predicate)),
          all: vi.fn(() => rowsFor(table).filter(predicate)),
        })),
      })),
    })),
    insert: vi.fn((table: any) => ({
      values: vi.fn((values: Record<string, any>) => ({
        run: vi.fn(() => {
          if (table !== schema.accounts) return {}
          if (state.failInsert) throw new Error('database path leaked')
          assertUniqueAccount(values)
          const row = { id: state.nextId++, ...values }
          state.accounts.push(row)
          return { lastInsertRowid: row.id }
        }),
      })),
    })),
    update: vi.fn((table: any) => ({
      set: vi.fn((values: Record<string, any>) => ({
        where: vi.fn((predicate: (row: any) => boolean) => ({
          run: vi.fn(() => {
            for (const row of rowsFor(table).filter(predicate)) {
              if (table === schema.accounts) assertUniqueAccount(values, row.id)
              state.operations.push({
                type: 'update',
                table: tableName(table),
                inTransaction: state.inTransaction,
              })
              Object.assign(row, values)
            }
          }),
        })),
      })),
    })),
    delete: vi.fn((table: any) => ({
      where: vi.fn((predicate: (row: any) => boolean) => ({
        run: vi.fn(() => {
          state.operations.push({
            type: 'delete',
            table: tableName(table),
            inTransaction: state.inTransaction,
          })
          if (table === schema.accounts) {
            state.accounts = state.accounts.filter((row) => !predicate(row))
          }
        }),
      })),
    })),
    transaction: vi.fn((callback: (tx: any) => unknown) => {
      state.transactionCalls++
      state.inTransaction = true
      try {
        return callback(db)
      } finally {
        state.inTransaction = false
      }
    }),
  }

  return {
    getDb: () => db,
    schema,
  }
})

async function loadRoute(path: string): Promise<RouteHandler> {
  const mod = await import(path)
  return mod.default
}

function resetState() {
  state.validAdmin = true
  state.nextId = 2
  state.accounts = [
    {
      id: 1,
      email: 'one@example.test',
      name: 'One',
      googleSub: 'google-one',
      accessToken: 'access-token-secret',
      refreshToken: 'refresh-token-secret',
      tokenExpiresAt: 1,
      creditsRemaining: 4.5,
      createdAt: 100,
      updatedAt: 100,
    },
  ]
  state.tasks = [
    { id: 10, accountId: 1, status: 'completed' },
    { id: 11, accountId: 1, status: 'failed' },
  ]
  state.inTransaction = false
  state.transactionCalls = 0
  state.operations = []
  state.failInsert = false
  state.failSelect = false
}

function encodeSupabaseSessionCookieParts(session: Record<string, unknown>) {
  const encoded = `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`
  return {
    cookiePart0: encoded.slice(0, 48),
    cookiePart1: encoded.slice(48),
  }
}

function encodeSupabaseSessionCookie(session: Record<string, unknown>): string {
  const { cookiePart0, cookiePart1 } = encodeSupabaseSessionCookieParts(session)
  return [
    `sb-ucljsqjaggrhupdayakz-auth-token.0=${cookiePart0}`,
    `sb-ucljsqjaggrhupdayakz-auth-token.1=${cookiePart1}`,
  ].join('; ')
}

describe('admin account token pool API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetState()
    vi.stubGlobal('defineEventHandler', (handler: RouteHandler) => handler)
    vi.stubGlobal('setResponseStatus', vi.fn())
    vi.stubGlobal('readBody', async (event: any) => event.body)
    vi.stubGlobal(
      'getRouterParam',
      (event: any, name: string) => event.params?.[name],
    )
  })

  it('rejects account lists without a valid admin key', async () => {
    state.validAdmin = false
    const handler = await loadRoute('../server/api/admin/accounts/index.get')

    const result = await handler({})

    expect(setResponseStatus).toHaveBeenCalledWith({}, 401)
    expect(result).toEqual({
      error: {
        message: 'Invalid admin key',
        code: 'invalid_admin_key',
      },
    })
  })

  it('lists accounts with token previews and task counts', async () => {
    const handler = await loadRoute('../server/api/admin/accounts/index.get')

    const result = await handler({})

    expect(result).toEqual({
      data: [
        {
          id: 1,
          email: 'one@example.test',
          name: 'One',
          googleSub: 'google-one',
          hasAccessToken: true,
          accessTokenPreview: 'acce***cret',
          hasRefreshToken: true,
          refreshTokenPreview: 'refr***cret',
          tokenExpiresAt: 1,
          tokenExpired: true,
          creditsRemaining: 4.5,
          taskCount: 2,
          createdAt: 100,
          updatedAt: 100,
        },
      ],
    })
    expect((result as any).data[0]).not.toHaveProperty('accessToken')
    expect((result as any).data[0]).not.toHaveProperty('refreshToken')
  })

  it('returns structured 500 JSON when account list reads fail unexpectedly', async () => {
    state.failSelect = true
    const handler = await loadRoute('../server/api/admin/accounts/index.get')
    const event = {}

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 500)
    expect(result).toEqual({
      error: {
        message: 'Admin database operation failed',
        code: 'admin_database_failed',
      },
    })
  })

  it('creates, clears token fields on update, and deletes accounts', async () => {
    const createHandler = await loadRoute('../server/api/admin/accounts/index.post')
    const created = await createHandler({
      body: {
        email: ' two@example.test ',
        name: ' Two ',
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        tokenExpiresAt: Date.now() + 60_000,
        creditsRemaining: 12.5,
      },
    })

    expect(created).toMatchObject({
      id: 2,
      email: 'two@example.test',
      name: 'Two',
      hasAccessToken: true,
      accessTokenPreview: 'new-***oken',
      hasRefreshToken: true,
      refreshTokenPreview: 'new-***oken',
      creditsRemaining: 12.5,
      taskCount: 0,
    })
    expect(created).not.toHaveProperty('accessToken')
    expect(created).not.toHaveProperty('refreshToken')
    expect(state.accounts.find((account) => account.id === 2)?.accessToken).toBe(
      'new-access-token',
    )

    const patchHandler = await loadRoute('../server/api/admin/accounts/[id].patch')
    const updated = await patchHandler({
      params: { id: '2' },
      body: {
        name: 'Two Updated',
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        creditsRemaining: null,
      },
    })

    expect(updated).toMatchObject({
      id: 2,
      name: 'Two Updated',
      hasAccessToken: false,
      accessTokenPreview: null,
      hasRefreshToken: false,
      refreshTokenPreview: null,
      tokenExpiresAt: null,
      tokenExpired: false,
      creditsRemaining: null,
    })
    expect(state.accounts.find((account) => account.id === 2)?.accessToken).toBeNull()

    state.tasks.push({ id: 12, accountId: 2, status: 'queued' })
    const deleteHandler = await loadRoute('../server/api/admin/accounts/[id].delete')
    const deleted = await deleteHandler({ params: { id: '2' } })

    expect(deleted).toEqual({ deleted: true })
    expect(state.accounts.find((account) => account.id === 2)).toBeUndefined()
    expect(state.tasks.find((task) => task.id === 12)?.accountId).toBeNull()
  })

  it('creates an account from a Supabase auth cookie header', async () => {
    const cookieHeader = encodeSupabaseSessionCookie({
      access_token: 'cookie-access-token',
      refresh_token: 'cookie-refresh-token',
      expires_at: 1782896787,
      user: {
        id: 'user-uuid',
        email: 'cookie@example.test',
        user_metadata: {
          full_name: 'Cookie User',
          provider_id: 'google-cookie',
        },
      },
    })
    const handler = await loadRoute('../server/api/admin/accounts/index.post')

    const created = await handler({
      body: { email: '', cookieHeader },
    })

    expect(created).toMatchObject({
      id: 2,
      email: 'cookie@example.test',
      name: 'Cookie User',
      googleSub: 'google-cookie',
      hasAccessToken: true,
      hasRefreshToken: true,
      tokenExpiresAt: 1782896787000,
    })
    expect(state.accounts.find((account) => account.id === 2)).toMatchObject({
      accessToken: 'cookie-access-token',
      refreshToken: 'cookie-refresh-token',
      tokenExpiresAt: 1782896787000,
    })
  })

  it('creates from split Supabase auth cookie fields and shows saved inputs on detail', async () => {
    const { cookiePart0, cookiePart1 } = encodeSupabaseSessionCookieParts({
      access_token: 'split-access-token',
      refresh_token: 'split-refresh-token',
      expires_at: 1782896787,
      user: {
        id: 'user-uuid',
        email: 'split@example.test',
        user_metadata: {
          full_name: 'Split Cookie User',
          provider_id: 'google-split',
        },
      },
    })
    const createHandler = await loadRoute('../server/api/admin/accounts/index.post')

    await createHandler({
      body: {
        cookiePart0,
        cookiePart1,
        authorizationHeader: 'Bearer split-access-token',
      },
    })

    const listHandler = await loadRoute('../server/api/admin/accounts/index.get')
    const list = await listHandler({})
    expect((list as any).data[1]).not.toHaveProperty('cookiePart0')
    expect((list as any).data[1]).not.toHaveProperty('cookiePart1')
    expect((list as any).data[1]).not.toHaveProperty('authorizationHeader')

    const detailHandler = await loadRoute('../server/api/admin/accounts/[id].get')
    const detail = await detailHandler({ params: { id: '2' } })

    expect(detail).toMatchObject({
      id: 2,
      email: 'split@example.test',
      cookiePart0,
      cookiePart1,
      authorizationHeader: 'Bearer split-access-token',
    })
    expect(state.accounts.find((account) => account.id === 2)).toMatchObject({
      cookiePart0,
      cookiePart1,
      authorizationHeader: 'Bearer split-access-token',
      accessToken: 'split-access-token',
      refreshToken: 'split-refresh-token',
    })
  })

  it('returns 409 JSON when creating a duplicate account', async () => {
    const handler = await loadRoute('../server/api/admin/accounts/index.post')
    const event = {
      body: {
        email: 'one@example.test',
        googleSub: 'google-two',
      },
    }

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 409)
    expect(result).toEqual({
      error: {
        message: 'Account already exists',
        code: 'duplicate_account',
      },
    })
    expect(state.accounts).toHaveLength(1)
  })

  it('returns structured 500 JSON when account creation hits an unexpected DB failure', async () => {
    state.failInsert = true
    const handler = await loadRoute('../server/api/admin/accounts/index.post')
    const event = {
      body: {
        email: 'two@example.test',
        googleSub: 'google-two',
      },
    }

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 500)
    expect(result).toEqual({
      error: {
        message: 'Admin database operation failed',
        code: 'admin_database_failed',
      },
    })
    expect(state.accounts).toHaveLength(1)
  })

  it('returns 409 JSON when updating account metadata to a duplicate', async () => {
    state.accounts.push({
      id: 2,
      email: 'two@example.test',
      name: 'Two',
      googleSub: 'google-two',
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      createdAt: 200,
      updatedAt: 200,
    })
    const handler = await loadRoute('../server/api/admin/accounts/[id].patch')
    const event = {
      params: { id: '2' },
      body: { googleSub: 'google-one' },
    }

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 409)
    expect(result).toEqual({
      error: {
        message: 'Account already exists',
        code: 'duplicate_account',
      },
    })
    expect(state.accounts.find((account) => account.id === 2)?.googleSub).toBe(
      'google-two',
    )
  })

  it('detaches tasks and deletes accounts inside a transaction', async () => {
    const handler = await loadRoute('../server/api/admin/accounts/[id].delete')

    const result = await handler({ params: { id: '1' } })

    expect(result).toEqual({ deleted: true })
    expect(state.transactionCalls).toBe(1)
    expect(state.operations).toEqual([
      { type: 'update', table: 'tasks', inTransaction: true },
      { type: 'update', table: 'tasks', inTransaction: true },
      { type: 'delete', table: 'accounts', inTransaction: true },
    ])
    expect(state.accounts).toHaveLength(0)
    expect(state.tasks.every((task) => task.accountId === null)).toBe(true)
  })

  it('returns one sanitized account with its task count', async () => {
    const handler = await loadRoute('../server/api/admin/accounts/[id].get')

    const result = await handler({ params: { id: '1' } })

    expect(result).toMatchObject({
      id: 1,
      email: 'one@example.test',
      hasAccessToken: true,
      accessTokenPreview: 'acce***cret',
      hasRefreshToken: true,
      refreshTokenPreview: 'refr***cret',
      authorizationHeader: 'Bearer access-token-secret',
      taskCount: 2,
    })
    expect(result).not.toHaveProperty('accessToken')
    expect(result).not.toHaveProperty('refreshToken')
  })

  it('returns 404 for missing account detail and delete requests', async () => {
    const detailHandler = await loadRoute('../server/api/admin/accounts/[id].get')
    const detailEvent = { params: { id: '999' } }

    const detail = await detailHandler(detailEvent)

    expect(setResponseStatus).toHaveBeenCalledWith(detailEvent, 404)
    expect(detail).toEqual({
      error: {
        message: 'Account not found',
        code: 'account_not_found',
      },
    })

    vi.mocked(setResponseStatus).mockClear()
    const deleteHandler = await loadRoute('../server/api/admin/accounts/[id].delete')
    const deleteEvent = { params: { id: '999' } }

    const deleted = await deleteHandler(deleteEvent)

    expect(setResponseStatus).toHaveBeenCalledWith(deleteEvent, 404)
    expect(deleted).toEqual({
      error: {
        message: 'Account not found',
        code: 'account_not_found',
      },
    })
  })
})
