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
  unlinkSync: vi.fn(),
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
    unlinkSync: fsState.unlinkSync,
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
        key: 'sk-local-admin-key',
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

function lastWrittenConfig() {
  const lastWrite = fsState.writeFileSync.mock.calls.at(-1)
  expect(lastWrite).toBeDefined()
  return loadYaml(lastWrite![1] as string) as any
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
    const pendingWrites = new Map<string, string>()
    fsState.writeFileSync.mockImplementation((path, yaml) => {
      pendingWrites.set(String(path), String(yaml))
    })
    fsState.renameSync.mockImplementation((tempPath, targetPath) => {
      const yaml = pendingWrites.get(String(tempPath))
      if (yaml !== undefined && String(targetPath) === configState.configPath) {
        configState.current = loadYaml(yaml) as any
      }
    })
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
      'sk-l***-key',
      '***',
    ])
  })

  it('omits unknown top-level and nested config fields from authenticated admin reads', async () => {
    adminAuthState.valid = true
    configState.current = {
      ...testConfig(),
      server: {
        ...testConfig().server,
        private_bind_token: 'server-secret',
      },
      reelmind: {
        ...testConfig().reelmind,
        client_secret: 'reelmind-secret',
      },
      database: {
        ...testConfig().database,
        password: 'database-secret',
      },
      polling: {
        ...testConfig().polling,
        backoff_secret: 'polling-secret',
      },
      webhook_secret: 'top-level-secret',
      diagnostics: { expose: false },
    }
    const handler = await loadRoute('../server/api/admin/config.get')

    const result = await handler({})

    expect(result).toEqual({
      server: { port: 3000, host: '0.0.0.0' },
      admin_key: 'admi***1234',
      api_keys: [
        {
          key: 'sk-l***-key',
          name: 'Primary',
          quota: 100,
          rate_limit: 60,
          enabled: true,
        },
        {
          key: '***',
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
    })
    expect(result).not.toHaveProperty('webhook_secret')
    expect(result).not.toHaveProperty('diagnostics')
    expect((result as any).server).not.toHaveProperty('private_bind_token')
    expect((result as any).reelmind).not.toHaveProperty('client_secret')
    expect((result as any).database).not.toHaveProperty('password')
    expect((result as any).polling).not.toHaveProperty('backoff_secret')
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

    const [tempPath, yaml, options] = fsState.writeFileSync.mock.calls[0]
    expect(dirname(tempPath)).toBe(dirname(configState.configPath))
    expect(options).toEqual({ encoding: 'utf-8', mode: 0o600 })
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
    expect(writtenConfig.api_keys[0].key).toBe('sk-local-admin-key')
  })

  it('returns structured 500 JSON when config patch persistence fails', async () => {
    adminAuthState.valid = true
    fsState.writeFileSync.mockImplementationOnce(() => {
      throw new Error('disk full with secret path details')
    })
    const handler = await loadRoute('../server/api/admin/config.patch')
    const event = { body: { server: { port: 4100 } } }

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 500)
    expect(result).toEqual({
      error: {
        message: 'Admin persistence failed',
        code: 'admin_persistence_failed',
      },
    })
    expect(configState.resetConfigCache).not.toHaveBeenCalled()
  })

  it('rejects admin API key list reads without a valid admin key', async () => {
    const handler = await loadRoute('../server/api/admin/api-keys/index.get')

    const result = await handler({})

    expect(setResponseStatus).toHaveBeenCalledWith({}, 401)
    expect(result).toEqual({
      error: {
        message: 'Invalid admin key',
        code: 'invalid_admin_key',
      },
    })
  })

  it('lists sanitized API keys for authenticated admins', async () => {
    adminAuthState.valid = true
    const handler = await loadRoute('../server/api/admin/api-keys/index.get')

    const result = await handler({})

    expect(result).toEqual({
      data: [
        {
          key: 'sk-l***-key',
          name: 'Primary',
          quota: 100,
          rate_limit: 60,
          enabled: true,
        },
        {
          key: '***',
          name: 'Short',
          quota: 0,
          rate_limit: 10,
          enabled: false,
        },
      ],
    })
  })

  it('omits extra API key config fields from sanitized admin responses', async () => {
    adminAuthState.valid = true
    configState.current = {
      ...testConfig(),
      api_keys: [
        {
          ...testConfig().api_keys[0],
          secret_note: 'do not expose this',
          metadata: { owner: 'internal' },
        },
      ],
    }
    const handler = await loadRoute('../server/api/admin/api-keys/index.get')

    const result = await handler({})

    expect(result).toEqual({
      data: [
        {
          key: 'sk-l***-key',
          name: 'Primary',
          quota: 100,
          rate_limit: 60,
          enabled: true,
        },
      ],
    })
    expect((result as any).data[0]).not.toHaveProperty('secret_note')
    expect((result as any).data[0]).not.toHaveProperty('metadata')
  })

  it('creates API keys, persists the raw key, and returns the sanitized entry', async () => {
    adminAuthState.valid = true
    const handler = await loadRoute('../server/api/admin/api-keys/index.post')
    const event = {
      body: {
        key: ' sk-created-key ',
        name: ' Created key ',
        quota: 250,
        rate_limit: 25,
        enabled: true,
      },
    }

    const result = await handler(event)

    expect(result).toEqual({
      key: 'sk-c***-key',
      name: 'Created key',
      quota: 250,
      rate_limit: 25,
      enabled: true,
    })
    expect(fsState.writeFileSync).toHaveBeenCalledOnce()
    expect(configState.resetConfigCache).toHaveBeenCalledOnce()

    const writtenConfig = lastWrittenConfig()
    expect(writtenConfig.api_keys).toContainEqual({
      key: 'sk-created-key',
      name: 'Created key',
      quota: 250,
      rate_limit: 25,
      enabled: true,
    })
  })

  it('returns structured 500 JSON when API key creation persistence fails', async () => {
    adminAuthState.valid = true
    fsState.writeFileSync.mockImplementationOnce(() => {
      throw new Error('raw config write failure')
    })
    const handler = await loadRoute('../server/api/admin/api-keys/index.post')
    const event = {
      body: {
        key: 'sk-created-key',
        name: 'Created key',
        quota: 250,
        rate_limit: 25,
        enabled: true,
      },
    }

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 500)
    expect(result).toEqual({
      error: {
        message: 'Admin persistence failed',
        code: 'admin_persistence_failed',
      },
    })
    expect(configState.resetConfigCache).not.toHaveBeenCalled()
  })

  it('rejects duplicate API key creation with a 409 response', async () => {
    adminAuthState.valid = true
    const handler = await loadRoute('../server/api/admin/api-keys/index.post')
    const event = {
      body: {
        key: 'sk-local-admin-key',
        name: 'Duplicate',
        quota: 1,
        rate_limit: 1,
        enabled: true,
      },
    }

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 409)
    expect(result).toEqual({
      error: {
        message: 'API key already exists',
        code: 'duplicate_api_key',
      },
    })
    expect(fsState.writeFileSync).not.toHaveBeenCalled()
    expect(fsState.renameSync).not.toHaveBeenCalled()
    expect(configState.resetConfigCache).not.toHaveBeenCalled()
  })

  it('rejects invalid API key creation payloads with a 400 response', async () => {
    adminAuthState.valid = true
    const handler = await loadRoute('../server/api/admin/api-keys/index.post')
    const event = {
      body: {
        key: '',
        name: 'Missing key',
        quota: 1,
        rate_limit: 1,
        enabled: true,
      },
    }

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 400)
    expect(result).toEqual({
      error: {
        message: 'Invalid API key field: key',
        code: 'invalid_api_key',
      },
    })
    expect(fsState.writeFileSync).not.toHaveBeenCalled()
    expect(fsState.renameSync).not.toHaveBeenCalled()
    expect(configState.resetConfigCache).not.toHaveBeenCalled()
  })

  it('creates, updates, lists, and deletes API keys through persisted route state', async () => {
    adminAuthState.valid = true
    const createHandler = await loadRoute('../server/api/admin/api-keys/index.post')
    const updateHandler = await loadRoute('../server/api/admin/api-keys/[key].patch')
    const listHandler = await loadRoute('../server/api/admin/api-keys/index.get')
    const deleteHandler = await loadRoute('../server/api/admin/api-keys/[key].delete')

    const created = await createHandler({
      body: {
        key: 'sk-flow-key',
        name: 'Flow key',
        quota: 10,
        rate_limit: 5,
        enabled: true,
      },
    })
    const updated = await updateHandler({
      params: { key: encodeURIComponent('sk-flow-key') },
      body: {
        key: 'sk-flow-renamed',
        name: 'Flow renamed',
        quota: 20,
        rate_limit: 8,
        enabled: false,
      },
    })
    const listedAfterUpdate = await listHandler({})
    const deleted = await deleteHandler({
      params: { key: encodeURIComponent('sk-flow-renamed') },
    })
    const listedAfterDelete = await listHandler({})

    expect(created).toEqual({
      key: 'sk-f***-key',
      name: 'Flow key',
      quota: 10,
      rate_limit: 5,
      enabled: true,
    })
    expect(updated).toEqual({
      key: 'sk-f***amed',
      name: 'Flow renamed',
      quota: 20,
      rate_limit: 8,
      enabled: false,
    })
    expect((listedAfterUpdate as any).data).toContainEqual({
      key: 'sk-f***amed',
      name: 'Flow renamed',
      quota: 20,
      rate_limit: 8,
      enabled: false,
    })
    expect(deleted).toEqual({ deleted: true })
    expect((listedAfterDelete as any).data).not.toContainEqual(
      expect.objectContaining({ name: 'Flow renamed' }),
    )
    expect(lastWrittenConfig().api_keys).not.toContainEqual(
      expect.objectContaining({ key: 'sk-flow-renamed' }),
    )
  })

  it('updates API keys by decoded path key, supports key replacement, and returns the sanitized entry', async () => {
    adminAuthState.valid = true
    configState.current = {
      ...testConfig(),
      api_keys: [
        ...testConfig().api_keys,
        {
          key: 'sk-created-key',
          name: 'Created key',
          quota: 250,
          rate_limit: 25,
          enabled: true,
        },
      ],
    }
    const handler = await loadRoute('../server/api/admin/api-keys/[key].patch')
    const event = {
      params: { key: encodeURIComponent('sk-created-key') },
      body: {
        key: 'sk-renamed-key',
        name: 'Renamed key',
        quota: 300,
        rate_limit: 30,
        enabled: false,
      },
    }

    const result = await handler(event)

    expect(result).toEqual({
      key: 'sk-r***-key',
      name: 'Renamed key',
      quota: 300,
      rate_limit: 30,
      enabled: false,
    })

    const writtenConfig = lastWrittenConfig()
    expect(writtenConfig.api_keys).not.toContainEqual(
      expect.objectContaining({ key: 'sk-created-key' }),
    )
    expect(writtenConfig.api_keys).toContainEqual({
      key: 'sk-renamed-key',
      name: 'Renamed key',
      quota: 300,
      rate_limit: 30,
      enabled: false,
    })
  })

  it('rejects API key replacements that conflict with existing keys', async () => {
    adminAuthState.valid = true
    configState.current = {
      ...testConfig(),
      api_keys: [
        ...testConfig().api_keys,
        {
          key: 'sk-created-key',
          name: 'Created key',
          quota: 250,
          rate_limit: 25,
          enabled: true,
        },
      ],
    }
    const handler = await loadRoute('../server/api/admin/api-keys/[key].patch')
    const event = {
      params: { key: encodeURIComponent('sk-created-key') },
      body: {
        key: 'sk-local-admin-key',
      },
    }

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 409)
    expect(result).toEqual({
      error: {
        message: 'API key already exists',
        code: 'duplicate_api_key',
      },
    })
    expect(fsState.writeFileSync).not.toHaveBeenCalled()
    expect(fsState.renameSync).not.toHaveBeenCalled()
    expect(configState.resetConfigCache).not.toHaveBeenCalled()
  })

  it('rejects empty API key update payloads with a 400 response', async () => {
    adminAuthState.valid = true
    const handler = await loadRoute('../server/api/admin/api-keys/[key].patch')
    const event = {
      params: { key: encodeURIComponent('sk-local-admin-key') },
      body: {},
    }

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 400)
    expect(result).toEqual({
      error: {
        message: 'Invalid API key payload',
        code: 'invalid_api_key',
      },
    })
    expect(fsState.writeFileSync).not.toHaveBeenCalled()
    expect(fsState.renameSync).not.toHaveBeenCalled()
    expect(configState.resetConfigCache).not.toHaveBeenCalled()
  })

  it('returns a 404 response when updating a missing API key', async () => {
    adminAuthState.valid = true
    const handler = await loadRoute('../server/api/admin/api-keys/[key].patch')
    const event = {
      params: { key: encodeURIComponent('sk-missing-key') },
      body: { name: 'Still missing' },
    }

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 404)
    expect(result).toEqual({
      error: {
        message: 'API key not found',
        code: 'api_key_not_found',
      },
    })
    expect(fsState.writeFileSync).not.toHaveBeenCalled()
  })

  it('deletes API keys by decoded path key without touching token rows', async () => {
    adminAuthState.valid = true
    configState.current = {
      ...testConfig(),
      api_keys: [
        ...testConfig().api_keys,
        {
          key: 'sk-created-key',
          name: 'Created key',
          quota: 250,
          rate_limit: 25,
          enabled: true,
        },
      ],
    }
    const handler = await loadRoute('../server/api/admin/api-keys/[key].delete')
    const event = {
      params: { key: encodeURIComponent('sk-created-key') },
    }

    const result = await handler(event)

    expect(result).toEqual({ deleted: true })
    const writtenConfig = lastWrittenConfig()
    expect(writtenConfig.api_keys).not.toContainEqual(
      expect.objectContaining({ key: 'sk-created-key' }),
    )
    expect(writtenConfig).not.toHaveProperty('api_tokens')
  })

  it('returns a 404 response when deleting a missing API key', async () => {
    adminAuthState.valid = true
    const handler = await loadRoute('../server/api/admin/api-keys/[key].delete')
    const event = {
      params: { key: encodeURIComponent('sk-missing-key') },
    }

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 404)
    expect(result).toEqual({
      error: {
        message: 'API key not found',
        code: 'api_key_not_found',
      },
    })
    expect(fsState.writeFileSync).not.toHaveBeenCalled()
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

  it('rejects blank admin key patches without writing config', async () => {
    adminAuthState.valid = true
    const handler = await loadRoute('../server/api/admin/config.patch')
    const event = { body: { admin_key: '' } }

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 400)
    expect(result).toEqual({
      error: {
        message: 'Invalid config field: admin_key',
        code: 'invalid_config_patch',
      },
    })
    expect(fsState.writeFileSync).not.toHaveBeenCalled()
    expect(fsState.renameSync).not.toHaveBeenCalled()
    expect(configState.resetConfigCache).not.toHaveBeenCalled()
  })

  it('rejects invalid known config patch field values without writing config', async () => {
    adminAuthState.valid = true
    const handler = await loadRoute('../server/api/admin/config.patch')
    const event = { body: { server: { port: 'abc' } } }

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 400)
    expect(result).toEqual({
      error: {
        message: 'Invalid config field: server.port',
        code: 'invalid_config_patch',
      },
    })
    expect(fsState.writeFileSync).not.toHaveBeenCalled()
    expect(fsState.renameSync).not.toHaveBeenCalled()
    expect(configState.resetConfigCache).not.toHaveBeenCalled()
  })

  it('removes the temp file when config rename fails', async () => {
    const renameError = new Error('rename failed')
    fsState.renameSync.mockImplementationOnce(() => {
      throw renameError
    })
    const { writeConfig } = await import('../server/utils/admin-config')

    expect(() => writeConfig(testConfig())).toThrow(renameError)

    const [tempPath, yaml, options] = fsState.writeFileSync.mock.calls[0]
    expect(options).toEqual({ encoding: 'utf-8', mode: 0o600 })
    expect(loadYaml(yaml as string)).toMatchObject(testConfig())
    expect(fsState.unlinkSync).toHaveBeenCalledWith(tempPath)
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
