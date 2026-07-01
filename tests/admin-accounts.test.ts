import { beforeEach, describe, expect, it, vi } from 'vitest'

type RouteHandler = (event: any) => Promise<unknown>

const state = vi.hoisted(() => ({
  validAdmin: true,
  nextId: 2,
  accounts: [] as Array<Record<string, any>>,
  tasks: [] as Array<Record<string, any>>,
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
    },
    tasks: {
      accountId: { key: 'accountId' },
    },
  }

  function rowsFor(table: any) {
    if (table === schema.accounts) return state.accounts
    if (table === schema.tasks) return state.tasks
    return []
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
              Object.assign(row, values)
            }
          }),
        })),
      })),
    })),
    delete: vi.fn((table: any) => ({
      where: vi.fn((predicate: (row: any) => boolean) => ({
        run: vi.fn(() => {
          if (table === schema.accounts) {
            state.accounts = state.accounts.filter((row) => !predicate(row))
          }
        }),
      })),
    })),
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
      createdAt: 100,
      updatedAt: 100,
    },
  ]
  state.tasks = [
    { id: 10, accountId: 1, status: 'completed' },
    { id: 11, accountId: 1, status: 'failed' },
  ]
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
          taskCount: 2,
          createdAt: 100,
          updatedAt: 100,
        },
      ],
    })
    expect((result as any).data[0]).not.toHaveProperty('accessToken')
    expect((result as any).data[0]).not.toHaveProperty('refreshToken')
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
    })
    expect(state.accounts.find((account) => account.id === 2)?.accessToken).toBeNull()

    state.tasks.push({ id: 12, accountId: 2, status: 'queued' })
    const deleteHandler = await loadRoute('../server/api/admin/accounts/[id].delete')
    const deleted = await deleteHandler({ params: { id: '2' } })

    expect(deleted).toEqual({ deleted: true })
    expect(state.accounts.find((account) => account.id === 2)).toBeUndefined()
    expect(state.tasks.find((task) => task.id === 12)?.accountId).toBeNull()
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
