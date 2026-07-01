import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  maskSecret,
  positiveInt,
  requiredString,
} from '../server/utils/admin-response'

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

describe('admin response helpers', () => {
  it('masks secrets without exposing very short values', () => {
    expect(maskSecret(null)).toBeNull()
    expect(maskSecret('')).toBeNull()
    expect(maskSecret('a')).toBe('***')
    expect(maskSecret('abcd')).toBe('***')
    expect(maskSecret('abcde')).toBe('ab***de')
    expect(maskSecret('abcdefgh')).toBe('ab***gh')
    expect(maskSecret('abcdefghi')).toBe('abcd***fghi')
  })

  it('parses positive integers with fallback and explicit max', () => {
    expect(positiveInt('5.9', 1)).toBe(5)
    expect(positiveInt(['7'], 1, 5)).toBe(5)
    expect(positiveInt('5', 1, 0)).toBe(0)
    expect(positiveInt(0, 3)).toBe(3)
    expect(positiveInt('not-a-number', 3)).toBe(3)
  })

  it('trims required strings and rejects blank or non-string values', () => {
    expect(requiredString('  value  ')).toBe('value')
    expect(requiredString('   ')).toBeNull()
    expect(requiredString(12)).toBeNull()
    expect(requiredString(null)).toBeNull()
  })
})
