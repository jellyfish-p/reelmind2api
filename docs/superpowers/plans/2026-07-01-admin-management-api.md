# Admin Management API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build authenticated `/api/admin/*` backend endpoints for frontend management of `config.yaml`, API keys, ReelMind token pool accounts, generation logs, and admin stats.

**Architecture:** Add small shared admin utilities for auth/error responses, config persistence, and serialization. Implement explicit Nuxt server routes rather than a passthrough so the browser only gets the intended admin surface. Tests load route handlers directly, mock Nuxt globals, and mock database/config helpers where persistence is not the behavior under test.

**Tech Stack:** Nuxt server routes, TypeScript, Drizzle ORM with better-sqlite3, `js-yaml`, Vitest.

---

## File Structure

- Create `server/utils/admin-response.ts`
  - Owns admin auth enforcement, JSON error shape, secret masking, route param parsing, pagination parsing, and simple body validation helpers.

- Modify `server/utils/config.ts`
  - Export config interfaces and `getConfigPath()`.
  - Keep existing `loadConfig()`, `resetConfigCache()`, `findApiKey()`, and `validateAdminKey()` behavior intact.

- Create `server/utils/admin-config.ts`
  - Owns sanitized config reads, safe YAML writes, allowed config patch validation, and API key CRUD against `config.yaml`.

- Create `server/utils/admin-accounts.ts`
  - Owns account token masking and account response shaping.

- Create `server/utils/admin-tasks.ts`
  - Owns task response shaping, task filter parsing, and summary aggregation helpers.

- Create route files:
  - `server/api/admin/config.get.ts`
  - `server/api/admin/config.patch.ts`
  - `server/api/admin/api-keys/index.get.ts`
  - `server/api/admin/api-keys/index.post.ts`
  - `server/api/admin/api-keys/[key].patch.ts`
  - `server/api/admin/api-keys/[key].delete.ts`
  - `server/api/admin/accounts/index.get.ts`
  - `server/api/admin/accounts/index.post.ts`
  - `server/api/admin/accounts/[id].get.ts`
  - `server/api/admin/accounts/[id].patch.ts`
  - `server/api/admin/accounts/[id].delete.ts`
  - `server/api/admin/tasks/index.get.ts`
  - `server/api/admin/tasks/[id].get.ts`
  - `server/api/admin/stats.get.ts`

- Create tests:
  - `tests/admin-config.test.ts`
  - `tests/admin-accounts.test.ts`
  - `tests/admin-tasks-stats.test.ts`

## Task 1: Shared Admin Response Helpers

**Files:**
- Create: `server/utils/admin-response.ts`
- Test: `tests/admin-config.test.ts`

- [ ] **Step 1: Write the failing auth and masking tests**

Add this initial test file:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/admin-config.test.ts`

Expected: FAIL because `server/api/admin/config.get` does not exist.

- [ ] **Step 3: Add shared admin helper**

Create `server/utils/admin-response.ts`:

```ts
import { authenticateAdmin } from './api-auth'

export interface AdminError {
  error: {
    message: string
    code: string
  }
}

export async function requireAdmin(event: any): Promise<AdminError | null> {
  if (await authenticateAdmin(event)) return null
  setResponseStatus(event, 401)
  return adminErrorBody('Invalid admin key', 'invalid_admin_key')
}

export function adminError(
  event: any,
  status: number,
  message: string,
  code: string,
): AdminError {
  setResponseStatus(event, status)
  return adminErrorBody(message, code)
}

function adminErrorBody(message: string, code: string): AdminError {
  return { error: { message, code } }
}

export function maskSecret(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  if (value.length <= 8) return `${value.slice(0, 2)}***${value.slice(-2)}`
  return `${value.slice(0, 4)}***${value.slice(-4)}`
}

export function positiveInt(value: unknown, fallback: number, max?: number): number {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  const integer = Math.floor(parsed)
  return max ? Math.min(integer, max) : integer
}

export function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
```

- [ ] **Step 4: Add minimal config read route**

Create `server/api/admin/config.get.ts`:

```ts
import { requireAdmin } from '../../utils/admin-response'
import { getSanitizedConfig } from '../../utils/admin-config'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError
  return getSanitizedConfig()
})
```

Also create a temporary minimal `server/utils/admin-config.ts` so the route imports resolve:

```ts
import { loadConfig } from './config'

export function getSanitizedConfig() {
  return loadConfig()
}
```

- [ ] **Step 5: Run test to verify unauthorized behavior passes**

Run: `npm run test:run -- tests/admin-config.test.ts`

Expected: PASS for the unauthorized config test.

- [ ] **Step 6: Commit**

Run:

```bash
git add server/utils/admin-response.ts server/utils/admin-config.ts server/api/admin/config.get.ts tests/admin-config.test.ts
git commit -m "feat: add admin auth response helpers"
```

## Task 2: Config Sanitization and Patch Persistence

**Files:**
- Modify: `server/utils/config.ts`
- Modify: `server/utils/admin-config.ts`
- Modify: `server/api/admin/config.get.ts`
- Create: `server/api/admin/config.patch.ts`
- Test: `tests/admin-config.test.ts`

- [ ] **Step 1: Extend failing config tests**

Append these tests to `tests/admin-config.test.ts`:

```ts
const configState = vi.hoisted(() => ({
  config: {
    server: { port: 3000, host: '0.0.0.0' },
    admin_key: 'admin-secret-value',
    api_keys: [
      {
        key: 'sk-local-admin-key',
        name: 'Default',
        quota: 1000,
        rate_limit: 60,
        enabled: true,
      },
    ],
    reelmind: {
      api_base: 'https://nestapi.reelmind.ai',
      web_base: 'https://reelmind.ai',
      google_client_id: '',
    },
    database: { path: './data/reelmind.db' },
    polling: { interval: 5000, max_retries: 120, token_refresh_margin: 300 },
  },
  written: null as any,
}))

vi.mock('../server/utils/config', () => ({
  loadConfig: vi.fn(() => configState.config),
  resetConfigCache: vi.fn(),
  getConfigPath: vi.fn(() => 'H:/tmp/config.yaml'),
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    writeFileSync: vi.fn((_path: string, content: string) => {
      configState.written = content
    }),
    renameSync: vi.fn(),
  }
})

it('returns sanitized config to authenticated admins', async () => {
  adminAuthState.valid = true
  const handler = await loadRoute('../server/api/admin/config.get')

  const result: any = await handler({})

  expect(result.admin_key).toBe('admi***alue')
  expect(result.api_keys[0].key).toBe('sk-l***-key')
  expect(result.api_keys[0]).toMatchObject({
    name: 'Default',
    quota: 1000,
    rate_limit: 60,
    enabled: true,
  })
})

it('patches allowed config fields and masks the response', async () => {
  adminAuthState.valid = true
  const handler = await loadRoute('../server/api/admin/config.patch')

  const result: any = await handler({
    body: {
      server: { port: 3100 },
      polling: { interval: 10000 },
    },
  })

  expect(result.server.port).toBe(3100)
  expect(result.polling.interval).toBe(10000)
  expect(result.admin_key).toBe('admi***alue')
  expect(configState.written).toContain('port: 3100')
  expect(configState.written).toContain('interval: 10000')
})

it('rejects unknown config patch fields', async () => {
  adminAuthState.valid = true
  const handler = await loadRoute('../server/api/admin/config.patch')

  const result = await handler({ body: { unsafe: true } })

  expect(setResponseStatus).toHaveBeenCalledWith({ body: { unsafe: true } }, 400)
  expect(result).toEqual({
    error: {
      message: 'Unsupported config field: unsafe',
      code: 'invalid_config_patch',
    },
  })
})
```

- [ ] **Step 2: Run test to verify failures**

Run: `npm run test:run -- tests/admin-config.test.ts`

Expected: FAIL because config patch route and persistence helpers are incomplete.

- [ ] **Step 3: Export config types and config path**

Modify `server/utils/config.ts` so the interfaces and path helper are exported:

```ts
export interface ApiKeyConfig {
  key: string
  name: string
  quota: number
  rate_limit: number
  enabled: boolean
}

export interface ReelmindConfig {
  api_base: string
  web_base: string
  google_client_id: string
}

export interface DatabaseConfig {
  path: string
}

export interface PollingConfig {
  interval: number
  max_retries: number
  token_refresh_margin: number
}

export function getConfigPath(): string {
  const cwd = process.cwd()
  const paths = [
    resolve(cwd, 'config.yaml'),
    resolve(cwd, 'config.yml'),
    resolve(dirname(fileURLToPath(import.meta.url)), '../../config.yaml'),
  ]
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  return resolve(cwd, 'config.yaml')
}
```

Keep the existing `AppConfig`, `loadConfig()`, `resetConfigCache()`, `findApiKey()`, and `validateAdminKey()` functions.

- [ ] **Step 4: Implement config sanitization and patching**

Replace `server/utils/admin-config.ts` with:

```ts
import { writeFileSync, renameSync } from 'fs'
import { dirname, join } from 'path'
import { dump as dumpYaml } from 'js-yaml'
import {
  type ApiKeyConfig,
  type AppConfig,
  getConfigPath,
  loadConfig,
  resetConfigCache,
} from './config'
import { maskSecret } from './admin-response'

export interface SanitizedApiKeyConfig extends Omit<ApiKeyConfig, 'key'> {
  key: string | null
}

export interface SanitizedAppConfig extends Omit<AppConfig, 'admin_key' | 'api_keys'> {
  admin_key: string | null
  api_keys: SanitizedApiKeyConfig[]
}

export function getSanitizedConfig(config: AppConfig = loadConfig()): SanitizedAppConfig {
  return {
    ...config,
    admin_key: maskSecret(config.admin_key),
    api_keys: sanitizeApiKeys(config.api_keys || []),
  }
}

export function sanitizeApiKeys(keys: ApiKeyConfig[]): SanitizedApiKeyConfig[] {
  return keys.map((key) => ({
    key: maskSecret(key.key),
    name: key.name,
    quota: key.quota,
    rate_limit: key.rate_limit,
    enabled: key.enabled !== false,
  }))
}

export function patchConfig(patch: Record<string, any>): SanitizedAppConfig {
  const config = structuredClone(loadConfig()) as AppConfig
  for (const key of Object.keys(patch)) {
    if (!['server', 'admin_key', 'reelmind', 'database', 'polling'].includes(key)) {
      throw new Error(`Unsupported config field: ${key}`)
    }
  }

  if (patch.server) config.server = { ...config.server, ...pick(patch.server, ['port', 'host']) }
  if (typeof patch.admin_key === 'string') config.admin_key = patch.admin_key
  if (patch.reelmind) config.reelmind = { ...config.reelmind, ...pick(patch.reelmind, ['api_base', 'web_base', 'google_client_id']) }
  if (patch.database) config.database = { ...config.database, ...pick(patch.database, ['path']) }
  if (patch.polling) config.polling = { ...config.polling, ...pick(patch.polling, ['interval', 'max_retries', 'token_refresh_margin']) }

  writeConfig(config)
  return getSanitizedConfig(config)
}

function pick(source: Record<string, any>, allowed: string[]): Record<string, any> {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) throw new Error(`Unsupported config field: ${key}`)
  }
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined),
  )
}

export function writeConfig(config: AppConfig): void {
  const configPath = getConfigPath()
  const tempPath = join(dirname(configPath), `.config.${process.pid}.${Date.now()}.tmp`)
  const yaml = dumpYaml(config, { lineWidth: 120, noRefs: true })
  writeFileSync(tempPath, yaml, 'utf-8')
  renameSync(tempPath, configPath)
  resetConfigCache()
}
```

- [ ] **Step 5: Add config patch route**

Create `server/api/admin/config.patch.ts`:

```ts
import { adminError, requireAdmin } from '../../utils/admin-response'
import { patchConfig } from '../../utils/admin-config'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError

  const body = await readBody(event)
  try {
    return patchConfig(body || {})
  } catch (err: any) {
    return adminError(event, 400, err.message, 'invalid_config_patch')
  }
})
```

- [ ] **Step 6: Run test to verify config behavior passes**

Run: `npm run test:run -- tests/admin-config.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add server/utils/config.ts server/utils/admin-config.ts server/api/admin/config.get.ts server/api/admin/config.patch.ts tests/admin-config.test.ts
git commit -m "feat: add admin config management"
```

## Task 3: API Key Management Routes

**Files:**
- Modify: `server/utils/admin-config.ts`
- Create: `server/api/admin/api-keys/index.get.ts`
- Create: `server/api/admin/api-keys/index.post.ts`
- Create: `server/api/admin/api-keys/[key].patch.ts`
- Create: `server/api/admin/api-keys/[key].delete.ts`
- Test: `tests/admin-config.test.ts`

- [ ] **Step 1: Add failing API key CRUD tests**

Append these tests to `tests/admin-config.test.ts`:

```ts
it('creates, updates, and deletes API keys through admin routes', async () => {
  adminAuthState.valid = true

  const createHandler = await loadRoute('../server/api/admin/api-keys/index.post')
  const created: any = await createHandler({
    body: {
      key: 'sk-created-key',
      name: 'Created',
      quota: 200,
      rate_limit: 20,
      enabled: true,
    },
  })
  expect(created).toMatchObject({
    key: 'sk-c***-key',
    name: 'Created',
    quota: 200,
    rate_limit: 20,
    enabled: true,
  })

  const patchHandler = await loadRoute('../server/api/admin/api-keys/[key].patch')
  const updated: any = await patchHandler({
    params: { key: 'sk-created-key' },
    body: { name: 'Renamed', quota: 300, enabled: false },
  })
  expect(updated).toMatchObject({
    key: 'sk-c***-key',
    name: 'Renamed',
    quota: 300,
    enabled: false,
  })

  const listHandler = await loadRoute('../server/api/admin/api-keys/index.get')
  const listed: any = await listHandler({})
  expect(listed.data.some((key: any) => key.name === 'Renamed')).toBe(true)

  const deleteHandler = await loadRoute('../server/api/admin/api-keys/[key].delete')
  const deleted: any = await deleteHandler({ params: { key: 'sk-created-key' } })
  expect(deleted).toEqual({ deleted: true })
})

it('rejects duplicate API keys', async () => {
  adminAuthState.valid = true
  const handler = await loadRoute('../server/api/admin/api-keys/index.post')

  const result = await handler({
    body: {
      key: 'sk-local-admin-key',
      name: 'Duplicate',
      quota: 100,
      rate_limit: 60,
      enabled: true,
    },
  })

  expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 409)
  expect(result).toEqual({
    error: {
      message: 'API key already exists',
      code: 'duplicate_api_key',
    },
  })
})
```

- [ ] **Step 2: Run test to verify failures**

Run: `npm run test:run -- tests/admin-config.test.ts`

Expected: FAIL because API key routes do not exist.

- [ ] **Step 3: Add API key CRUD helpers**

Append to `server/utils/admin-config.ts`:

```ts
export function listApiKeys(): SanitizedApiKeyConfig[] {
  return sanitizeApiKeys(loadConfig().api_keys || [])
}

export function createApiKey(input: Partial<ApiKeyConfig>): SanitizedApiKeyConfig {
  const config = structuredClone(loadConfig()) as AppConfig
  const key = normalizeApiKey(input)
  if (config.api_keys.some((entry) => entry.key === key.key)) {
    throw Object.assign(new Error('API key already exists'), { statusCode: 409, code: 'duplicate_api_key' })
  }
  config.api_keys.push(key)
  writeConfig(config)
  return sanitizeApiKeys([key])[0]
}

export function updateApiKey(currentKey: string, patch: Partial<ApiKeyConfig>): SanitizedApiKeyConfig | null {
  const config = structuredClone(loadConfig()) as AppConfig
  const index = config.api_keys.findIndex((entry) => entry.key === currentKey)
  if (index < 0) return null
  const next = normalizeApiKey({ ...config.api_keys[index], ...patch })
  if (next.key !== currentKey && config.api_keys.some((entry) => entry.key === next.key)) {
    throw Object.assign(new Error('API key already exists'), { statusCode: 409, code: 'duplicate_api_key' })
  }
  config.api_keys[index] = next
  writeConfig(config)
  return sanitizeApiKeys([next])[0]
}

export function deleteApiKey(currentKey: string): boolean {
  const config = structuredClone(loadConfig()) as AppConfig
  const before = config.api_keys.length
  config.api_keys = config.api_keys.filter((entry) => entry.key !== currentKey)
  if (config.api_keys.length === before) return false
  writeConfig(config)
  return true
}

function normalizeApiKey(input: Partial<ApiKeyConfig>): ApiKeyConfig {
  if (!input.key || !input.name) throw Object.assign(new Error('key and name are required'), { statusCode: 400, code: 'invalid_api_key' })
  return {
    key: input.key,
    name: input.name,
    quota: Number(input.quota ?? 1000),
    rate_limit: Number(input.rate_limit ?? 60),
    enabled: input.enabled !== false,
  }
}
```

- [ ] **Step 4: Add API key route files**

Create `server/api/admin/api-keys/index.get.ts`:

```ts
import { requireAdmin } from '../../../utils/admin-response'
import { listApiKeys } from '../../../utils/admin-config'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError
  return { data: listApiKeys() }
})
```

Create `server/api/admin/api-keys/index.post.ts`:

```ts
import { adminError, requireAdmin } from '../../../utils/admin-response'
import { createApiKey } from '../../../utils/admin-config'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError
  try {
    return createApiKey(await readBody(event))
  } catch (err: any) {
    return adminError(event, err.statusCode || 400, err.message, err.code || 'invalid_api_key')
  }
})
```

Create `server/api/admin/api-keys/[key].patch.ts`:

```ts
import { adminError, requireAdmin } from '../../../utils/admin-response'
import { updateApiKey } from '../../../utils/admin-config'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError
  const key = decodeURIComponent(getRouterParam(event, 'key') || '')
  try {
    const updated = updateApiKey(key, await readBody(event))
    if (!updated) return adminError(event, 404, 'API key not found', 'api_key_not_found')
    return updated
  } catch (err: any) {
    return adminError(event, err.statusCode || 400, err.message, err.code || 'invalid_api_key')
  }
})
```

Create `server/api/admin/api-keys/[key].delete.ts`:

```ts
import { adminError, requireAdmin } from '../../../utils/admin-response'
import { deleteApiKey } from '../../../utils/admin-config'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError
  const key = decodeURIComponent(getRouterParam(event, 'key') || '')
  if (!deleteApiKey(key)) return adminError(event, 404, 'API key not found', 'api_key_not_found')
  return { deleted: true }
})
```

- [ ] **Step 5: Run API key tests**

Run: `npm run test:run -- tests/admin-config.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add server/utils/admin-config.ts server/api/admin/api-keys tests/admin-config.test.ts
git commit -m "feat: add admin api key management"
```

## Task 4: Token Pool Account Routes

**Files:**
- Create: `server/utils/admin-accounts.ts`
- Create route files under `server/api/admin/accounts`
- Test: `tests/admin-accounts.test.ts`

- [ ] **Step 1: Write failing account tests**

Create `tests/admin-accounts.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

type RouteHandler = (event: any) => Promise<unknown>

const state = vi.hoisted(() => ({
  validAdmin: true,
  nextId: 2,
  accounts: [
    {
      id: 1,
      email: 'one@example.test',
      name: 'One',
      googleSub: 'google-one',
      accessToken: 'access-token-secret',
      refreshToken: 'refresh-token-secret',
      tokenExpiresAt: Date.now() - 1000,
      createdAt: 100,
      updatedAt: 100,
    },
  ] as Array<Record<string, any>>,
  tasks: [
    { id: 10, accountId: 1, status: 'completed' },
    { id: 11, accountId: 1, status: 'failed' },
  ] as Array<Record<string, any>>,
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
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: any) => ({
        all: vi.fn(() => (table === schema.accounts ? state.accounts : state.tasks)),
        where: vi.fn((predicate: any) => ({
          get: vi.fn(() => (table === schema.accounts ? state.accounts : state.tasks).find(predicate)),
          all: vi.fn(() => (table === schema.accounts ? state.accounts : state.tasks).filter(predicate)),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, any>) => ({
        run: vi.fn(() => {
          const row = { id: state.nextId++, ...values }
          state.accounts.push(row)
          return { lastInsertRowid: row.id }
        }),
      })),
    })),
    update: vi.fn((table: any) => ({
      set: vi.fn((values: Record<string, any>) => ({
        where: vi.fn((predicate: any) => ({
          run: vi.fn(() => {
            const rows = table === schema.accounts ? state.accounts : state.tasks
            for (const row of rows.filter(predicate)) Object.assign(row, values)
          }),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn((predicate: any) => ({
        run: vi.fn(() => {
          state.accounts = state.accounts.filter((row) => !predicate(row))
        }),
      })),
    })),
  }
  return { getDb: () => db, schema }
})

async function loadRoute(path: string): Promise<RouteHandler> {
  const mod = await import(path)
  return mod.default
}

describe('admin account token pool API', () => {
  beforeEach(() => {
    vi.resetModules()
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
        tokenExpiresAt: Date.now() - 1000,
        createdAt: 100,
        updatedAt: 100,
      },
    ]
    state.tasks = [
      { id: 10, accountId: 1, status: 'completed' },
      { id: 11, accountId: 1, status: 'failed' },
    ]
    vi.stubGlobal('defineEventHandler', (handler: RouteHandler) => handler)
    vi.stubGlobal('setResponseStatus', vi.fn())
    vi.stubGlobal('readBody', async (event: any) => event.body)
    vi.stubGlobal('getRouterParam', (event: any, name: string) => event.params?.[name])
  })

  it('lists accounts with token previews and task counts', async () => {
    const handler = await loadRoute('../server/api/admin/accounts/index.get')
    const result: any = await handler({})

    expect(result.data[0]).toMatchObject({
      id: 1,
      email: 'one@example.test',
      hasAccessToken: true,
      accessTokenPreview: 'acce***cret',
      hasRefreshToken: true,
      refreshTokenPreview: 'refr***cret',
      tokenExpired: true,
      taskCount: 2,
    })
    expect(result.data[0]).not.toHaveProperty('accessToken')
    expect(result.data[0]).not.toHaveProperty('refreshToken')
  })

  it('creates, updates, and deletes accounts', async () => {
    const createHandler = await loadRoute('../server/api/admin/accounts/index.post')
    const created: any = await createHandler({
      body: {
        email: 'two@example.test',
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        tokenExpiresAt: Date.now() + 3600,
      },
    })
    expect(created).toMatchObject({ id: 2, email: 'two@example.test' })

    const patchHandler = await loadRoute('../server/api/admin/accounts/[id].patch')
    const updated: any = await patchHandler({
      params: { id: '2' },
      body: { name: 'Two Updated', accessToken: null },
    })
    expect(updated).toMatchObject({
      id: 2,
      name: 'Two Updated',
      hasAccessToken: false,
    })

    const deleteHandler = await loadRoute('../server/api/admin/accounts/[id].delete')
    const deleted = await deleteHandler({ params: { id: '2' } })
    expect(deleted).toEqual({ deleted: true })
    expect(state.accounts.find((account) => account.id === 2)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify failures**

Run: `npm run test:run -- tests/admin-accounts.test.ts`

Expected: FAIL because account routes do not exist.

- [ ] **Step 3: Add account serializer**

Create `server/utils/admin-accounts.ts`:

```ts
import { maskSecret } from './admin-response'

export function sanitizeAccount(account: any, tasks: any[] = []) {
  const now = Date.now()
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    googleSub: account.googleSub,
    hasAccessToken: !!account.accessToken,
    accessTokenPreview: maskSecret(account.accessToken),
    hasRefreshToken: !!account.refreshToken,
    refreshTokenPreview: maskSecret(account.refreshToken),
    tokenExpiresAt: account.tokenExpiresAt,
    tokenExpired: account.tokenExpiresAt ? account.tokenExpiresAt < now : false,
    taskCount: tasks.length,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }
}

export function accountValues(input: Record<string, any>, now = Date.now()) {
  return {
    email: input.email,
    name: input.name,
    googleSub: input.googleSub,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    tokenExpiresAt: input.tokenExpiresAt,
    createdAt: now,
    updatedAt: now,
  }
}

export function accountPatchValues(input: Record<string, any>, now = Date.now()) {
  const values: Record<string, any> = { updatedAt: now }
  for (const key of ['email', 'name', 'googleSub', 'accessToken', 'refreshToken', 'tokenExpiresAt']) {
    if (key in input) values[key] = input[key]
  }
  return values
}
```

- [ ] **Step 4: Add account routes**

Create route files using this pattern:

```ts
import { eq } from 'drizzle-orm'
import { adminError, requireAdmin } from '../../../utils/admin-response'
import { getDb, schema } from '../../../db'
import { accountPatchValues, accountValues, sanitizeAccount } from '../../../utils/admin-accounts'
```

For list, select all accounts and all tasks, then return:

```ts
return {
  data: accounts.map((account: any) =>
    sanitizeAccount(account, tasks.filter((task: any) => task.accountId === account.id)),
  ),
}
```

For create, require a non-empty `email`, insert `accountValues(body)`, then fetch by inserted id and return `sanitizeAccount(account, [])`.

For detail, parse numeric `id`, fetch account by `schema.accounts.id`, fetch tasks where `schema.tasks.accountId` equals id, return `404` if missing.

For patch, parse numeric `id`, update `accountPatchValues(body)`, fetch and return sanitized account.

For delete, set matching task rows to `{ accountId: null }`, delete the account, and return `{ deleted: true }`.

- [ ] **Step 5: Run account tests**

Run: `npm run test:run -- tests/admin-accounts.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add server/utils/admin-accounts.ts server/api/admin/accounts tests/admin-accounts.test.ts
git commit -m "feat: add admin token pool management"
```

## Task 5: Task Logs and Detail Routes

**Files:**
- Create: `server/utils/admin-tasks.ts`
- Create: `server/api/admin/tasks/index.get.ts`
- Create: `server/api/admin/tasks/[id].get.ts`
- Test: `tests/admin-tasks-stats.test.ts`

- [ ] **Step 1: Write failing task log tests**

Create `tests/admin-tasks-stats.test.ts` with mocked admin auth, `getQuery`, `getRouterParam`, and database state containing accounts, tasks, and api tokens. Tests must assert:

```ts
it('filters and paginates admin task logs', async () => {
  const handler = await loadRoute('../server/api/admin/tasks/index.get')
  const result: any = await handler({
    query: { status: 'completed', page: '1', limit: '1' },
  })

  expect(result.pagination).toEqual({ page: 1, limit: 1, total: 2 })
  expect(result.data).toHaveLength(1)
  expect(result.data[0]).toMatchObject({
    id: 1,
    taskId: 'task-public-1',
    status: 'completed',
  })
})

it('loads task detail by public task id', async () => {
  const handler = await loadRoute('../server/api/admin/tasks/[id].get')
  const result: any = await handler({ params: { id: 'task-public-1' } })

  expect(result).toMatchObject({
    id: 1,
    taskId: 'task-public-1',
    parameters: { model_id: 'video-model' },
    resultData: { url: 'https://result.example/video.mp4' },
  })
})
```

- [ ] **Step 2: Run test to verify failures**

Run: `npm run test:run -- tests/admin-tasks-stats.test.ts`

Expected: FAIL because task routes do not exist.

- [ ] **Step 3: Add task helpers**

Create `server/utils/admin-tasks.ts`:

```ts
import { positiveInt } from './admin-response'

export function parseTaskFilters(query: Record<string, any>) {
  return {
    status: scalar(query.status),
    type: scalar(query.type),
    model: scalar(query.model),
    accountId: numeric(query.account_id),
    apiTokenId: numeric(query.api_token_id),
    createdFrom: numeric(query.created_from),
    createdTo: numeric(query.created_to),
  }
}

export function paginate<T>(items: T[], query: Record<string, any>) {
  const page = positiveInt(query.page, 1)
  const limit = positiveInt(query.limit, 20, 100)
  const start = (page - 1) * limit
  return {
    data: items.slice(start, start + limit),
    pagination: { page, limit, total: items.length },
  }
}

export function matchesTaskFilters(task: any, filters: ReturnType<typeof parseTaskFilters>) {
  if (filters.status && task.status !== filters.status) return false
  if (filters.type && task.type !== filters.type) return false
  if (filters.model && task.model !== filters.model) return false
  if (filters.accountId !== undefined && task.accountId !== filters.accountId) return false
  if (filters.apiTokenId !== undefined && task.apiTokenId !== filters.apiTokenId) return false
  if (filters.createdFrom !== undefined && task.createdAt < filters.createdFrom) return false
  if (filters.createdTo !== undefined && task.createdAt > filters.createdTo) return false
  return true
}

export function summarizeTask(task: any) {
  return {
    id: task.id,
    taskId: task.taskId,
    object: task.object,
    model: task.model,
    type: task.type,
    prompt: task.prompt,
    status: task.status,
    progress: task.progress,
    resultUrl: task.resultUrl,
    errorMessage: task.errorMessage,
    reelmindTaskId: task.reelmindTaskId,
    apiTokenId: task.apiTokenId,
    accountId: task.accountId,
    creditsUsed: task.creditsUsed,
    pollCount: task.pollCount,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
  }
}

export function detailTask(task: any) {
  return {
    ...summarizeTask(task),
    negativePrompt: task.negativePrompt,
    imageUrl: task.imageUrl,
    aspectRatio: task.aspectRatio,
    duration: task.duration,
    resolution: task.resolution,
    parameters: parseJson(task.parameters),
    resultData: parseJson(task.resultData),
  }
}

function scalar(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' && raw ? raw : undefined
}

function numeric(value: unknown): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseJson(value: unknown) {
  if (typeof value !== 'string' || !value) return value ?? null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
```

- [ ] **Step 4: Add task routes**

Create `server/api/admin/tasks/index.get.ts`:

```ts
import { requireAdmin } from '../../../utils/admin-response'
import { getDb, schema } from '../../../db'
import { matchesTaskFilters, paginate, parseTaskFilters, summarizeTask } from '../../../utils/admin-tasks'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError
  const query = getQuery(event)
  const filters = parseTaskFilters(query)
  const tasks = getDb().select().from(schema.tasks).all()
  const filtered = tasks.filter((task: any) => matchesTaskFilters(task, filters))
  const page = paginate(filtered.map(summarizeTask), query)
  return page
})
```

Create `server/api/admin/tasks/[id].get.ts`:

```ts
import { adminError, requireAdmin } from '../../../utils/admin-response'
import { getDb, schema } from '../../../db'
import { detailTask } from '../../../utils/admin-tasks'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError
  const id = getRouterParam(event, 'id') || ''
  const tasks = getDb().select().from(schema.tasks).all()
  const numericId = Number(id)
  const task = tasks.find((row: any) =>
    (Number.isFinite(numericId) && row.id === numericId) || row.taskId === id,
  )
  if (!task) return adminError(event, 404, 'Task not found', 'task_not_found')
  return detailTask(task)
})
```

- [ ] **Step 5: Run task route tests**

Run: `npm run test:run -- tests/admin-tasks-stats.test.ts`

Expected: task tests PASS, stats test still absent.

- [ ] **Step 6: Commit**

Run:

```bash
git add server/utils/admin-tasks.ts server/api/admin/tasks tests/admin-tasks-stats.test.ts
git commit -m "feat: add admin task logs"
```

## Task 6: Admin Stats Route

**Files:**
- Modify: `server/utils/admin-tasks.ts`
- Create: `server/api/admin/stats.get.ts`
- Test: `tests/admin-tasks-stats.test.ts`

- [ ] **Step 1: Add failing stats test**

Append to `tests/admin-tasks-stats.test.ts`:

```ts
it('returns admin dashboard stats', async () => {
  const handler = await loadRoute('../server/api/admin/stats.get')
  const result: any = await handler({})

  expect(result.tasks.byStatus).toMatchObject({
    completed: 2,
    failed: 1,
  })
  expect(result.tasks.byType.video).toBe(2)
  expect(result.tasks.totalCreditsUsed).toBe(7.5)
  expect(result.accounts.total).toBe(2)
  expect(result.accounts.expiredTokens).toBe(1)
  expect(result.apiKeys.total).toBe(2)
})
```

- [ ] **Step 2: Run stats test to verify failure**

Run: `npm run test:run -- tests/admin-tasks-stats.test.ts`

Expected: FAIL because stats route does not exist.

- [ ] **Step 3: Add aggregation helper**

Append to `server/utils/admin-tasks.ts`:

```ts
export function countBy(rows: any[], field: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of rows) {
    const key = String(row[field] || 'unknown')
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

export function sumCredits(rows: any[]): number {
  return rows.reduce((sum, row) => sum + (Number(row.creditsUsed) || 0), 0)
}
```

- [ ] **Step 4: Add stats route**

Create `server/api/admin/stats.get.ts`:

```ts
import { requireAdmin } from '../../utils/admin-response'
import { getDb, schema } from '../../db'
import { loadConfig } from '../../utils/config'
import { countBy, sumCredits } from '../../utils/admin-tasks'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError
  const db = getDb()
  const tasks = db.select().from(schema.tasks).all()
  const accounts = db.select().from(schema.accounts).all()
  const now = Date.now()
  const recentThreshold = now - 24 * 60 * 60 * 1000

  return {
    tasks: {
      total: tasks.length,
      recent: tasks.filter((task: any) => task.createdAt >= recentThreshold).length,
      byStatus: countBy(tasks, 'status'),
      byType: countBy(tasks, 'type'),
      totalCreditsUsed: sumCredits(tasks),
    },
    accounts: {
      total: accounts.length,
      expiredTokens: accounts.filter((account: any) => account.tokenExpiresAt && account.tokenExpiresAt < now).length,
    },
    apiKeys: {
      total: (loadConfig().api_keys || []).length,
    },
  }
})
```

- [ ] **Step 5: Run stats tests**

Run: `npm run test:run -- tests/admin-tasks-stats.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add server/utils/admin-tasks.ts server/api/admin/stats.get.ts tests/admin-tasks-stats.test.ts
git commit -m "feat: add admin dashboard stats"
```

## Task 7: Full Verification

**Files:**
- Review all files touched in Tasks 1-6.

- [ ] **Step 1: Run focused admin tests**

Run:

```bash
npm run test:run -- tests/admin-config.test.ts tests/admin-accounts.test.ts tests/admin-tasks-stats.test.ts
```

Expected: all admin tests PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm run test:run
```

Expected: all tests PASS.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: build exits with code 0.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only admin API implementation files, admin tests, and any pre-existing unrelated local changes remain.

- [ ] **Step 5: Commit final fixes if needed**

If verification required small fixes after the previous task commits, commit them:

```bash
git add server/api/admin server/utils/admin-response.ts server/utils/admin-config.ts server/utils/admin-accounts.ts server/utils/admin-tasks.ts server/utils/config.ts tests/admin-config.test.ts tests/admin-accounts.test.ts tests/admin-tasks-stats.test.ts
git commit -m "test: verify admin management api"
```

## Self-Review

- Spec coverage: config read/patch, API key CRUD, token pool account CRUD, task log list/detail, stats, admin auth, masking, and verification are each covered by a task.
- Placeholder scan: no `TBD`, `TODO`, or deferred implementation steps remain.
- Type consistency: route paths, helper names, and response field names match across tasks.
