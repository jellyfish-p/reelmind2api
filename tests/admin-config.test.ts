import { beforeEach, describe, expect, it, vi } from 'vitest'

type RouteHandler = (event: any) => Promise<unknown>

const adminAuthState = vi.hoisted(() => ({
  valid: false,
}))

vi.mock('../server/utils/api-auth', () => ({
  authenticateAdmin: vi.fn(async () => adminAuthState.valid),
}))

async function loadRoute(path: string): Promise<RouteHandler> {
  const mod = await import(path)
  return mod.default
}

describe('admin config API', () => {
  beforeEach(() => {
    vi.resetModules()
    adminAuthState.valid = false
    vi.stubGlobal('defineEventHandler', (handler: RouteHandler) => handler)
    vi.stubGlobal('setResponseStatus', vi.fn())
    vi.stubGlobal('readBody', async (event: any) => event.body)
    vi.stubGlobal('getRouterParam', (event: any, name: string) => event.params?.[name])
  })

  it('rejects admin config reads without a valid admin key', async () => {
    const handler = await loadRoute('../server/api/admin/config.get')

    const result = await handler({})

    expect(setResponseStatus).toHaveBeenCalledWith({}, 401)
    expect(result).toEqual({
      error: {
        message: 'Invalid admin key',
        code: 'invalid_admin_key',
      },
    })
  })
})
