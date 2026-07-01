import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dirname } from 'path'
import { load as loadYaml } from 'js-yaml'
import {
  maskSecret,
  positiveInt,
  requiredString,
} from '../server/utils/admin-response'

type RouteHandler = (event: any) => Promise<unknown>

const adminAuthState = vi.hoisted(() => ({
  valid: false,
}))

const configState = vi.hoisted(() => ({
  current: undefined as any,
  configPath: 'H:\\Documents\\GitHub\\reelmind2api\\.test-tmp\\config.yaml',
  getConfigPath: vi.fn(() => configState.configPath),
  loadConfig: vi.fn(() => configState.current),
  resetConfigCache: vi.fn(),
}))

const fsState = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
}))

vi.mock('../server/utils/api-auth', () => ({
  authenticateAdmin: vi.fn(async () => adminAuthState.valid),
}))

vi.mock('../server/utils/config', () => ({
  getConfigPath: configState.getConfigPath,
  loadConfig: configState.loadConfig,
  resetConfigCache: configState.resetConfigCache,
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    writeFileSync: fsState.writeFileSync,
    renameSync: fsState.renameSync,
  }
})

async function loadRoute(path: string): Promise<RouteHandler> {
  const mod = await import(path)
  return mod.default
}

function testConfig() {
  return {
    server: { port: 3000, host: '0.0.0.0' },
    admin_key: 'admin-secret-1234',
    api_keys: [
      {
        key: 'sk-test-key-123456',
        name: 'Primary',
        quota: 100,
        rate_limit: 60,
        enabled: true,
      },
      {
        key: 'tiny',
        name: 'Short',
        quota: 0,
        rate_limit: 10,
        enabled: false,
      },
    ],
    reelmind: {
      api_base: 'https://nestapi.reelmind.ai',
      web_base: 'https://reelmind.ai',
      google_client_id: 'google-client',
    },
    database: { path: './data/reelmind.db' },
    polling: {
      interval: 5000,
      max_retries: 120,
      token_refresh_margin: 300,
    },
  }
}

function sanitizedConfig(overrides: any = {}) {
  const base = testConfig()
  const config = {
    ...base,
    ...overrides,
    server: { ...base.server, ...overrides.server },
    reelmind: { ...base.reelmind, ...overrides.reelmind },
    database: { ...base.database, ...overrides.database },
    polling: { ...base.polling, ...overrides.polling },
  }

  return {
    ...config,
    admin_key: maskSecret(config.admin_key),
    api_keys: config.api_keys.map((apiKey: any) => ({
      ...apiKey,
      key: maskSecret(apiKey.key),
    })),
  }
}

describe('admin config API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    adminAuthState.valid = false
    configState.current = testConfig()
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

  it('returns sanitized config for authenticated admin reads', async () => {
    adminAuthState.valid = true
    const handler = await loadRoute('../server/api/admin/config.get')

    const result = await handler({})

    expect(result).toEqual(sanitizedConfig())
    expect((result as any).admin_key).toBe('admi***1234')
    expect((result as any).api_keys.map((apiKey: any) => apiKey.key)).toEqual([
      'sk-t***3456',
      '***',
    ])
  })

  it('patches allowed config fields, persists YAML, resets cache, and returns sanitized config', async () => {
    adminAuthState.valid = true
    const handler = await loadRoute('../server/api/admin/config.patch')
    const patch = {
      server: { port: 4100 },
      admin_key: 'new-admin-secret',
      reelmind: { api_base: 'https://api.example.test' },
      database: { path: './data/test.db' },
      polling: { interval: 2500, max_retries: 42 },
    }

    const result = await handler({ body: patch })

    expect(result).toEqual(sanitizedConfig(patch))
    expect((result as any).admin_key).toBe('new-***cret')
    expect(fsState.writeFileSync).toHaveBeenCalledOnce()
    expect(fsState.renameSync).toHaveBeenCalledOnce()
    expect(configState.resetConfigCache).toHaveBeenCalledOnce()

    const [tempPath, yaml, encoding] = fsState.writeFileSync.mock.calls[0]
    expect(dirname(tempPath)).toBe(dirname(configState.configPath))
    expect(encoding).toBe('utf-8')
    expect(fsState.renameSync).toHaveBeenCalledWith(tempPath, configState.configPath)

    const writtenConfig = loadYaml(yaml as string) as any
    expect(writtenConfig).toMatchObject({
      server: { port: 4100, host: '0.0.0.0' },
      admin_key: 'new-admin-secret',
      reelmind: {
        api_base: 'https://api.example.test',
        web_base: 'https://reelmind.ai',
        google_client_id: 'google-client',
      },
      database: { path: './data/test.db' },
      polling: {
        interval: 2500,
        max_retries: 42,
        token_refresh_margin: 300,
      },
    })
    expect(writtenConfig.api_keys[0].key).toBe('sk-test-key-123456')
  })

  it('rejects unknown top-level config patch fields', async () => {
    adminAuthState.valid = true
    const handler = await loadRoute('../server/api/admin/config.patch')
    const event = { body: { unsafe: true } }

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 400)
    expect(result).toEqual({
      error: {
        message: 'Unsupported config field: unsafe',
        code: 'invalid_config_patch',
      },
    })
    expect(fsState.writeFileSync).not.toHaveBeenCalled()
    expect(fsState.renameSync).not.toHaveBeenCalled()
    expect(configState.resetConfigCache).not.toHaveBeenCalled()
  })

  it('rejects unknown nested config patch fields', async () => {
    adminAuthState.valid = true
    const handler = await loadRoute('../server/api/admin/config.patch')
    const event = { body: { reelmind: { unsafe: true } } }

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 400)
    expect(result).toEqual({
      error: {
        message: 'Unsupported config field: reelmind.unsafe',
        code: 'invalid_config_patch',
      },
    })
    expect(fsState.writeFileSync).not.toHaveBeenCalled()
    expect(fsState.renameSync).not.toHaveBeenCalled()
    expect(configState.resetConfigCache).not.toHaveBeenCalled()
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
