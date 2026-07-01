import { beforeEach, describe, expect, it, vi } from 'vitest'

const configState = vi.hoisted(() => ({
  current: {
    server: { port: 3000, host: '0.0.0.0' },
    admin_key: 'admin-secret',
    api_keys: [],
    reelmind: {
      api_base: 'https://nestapi.reelmind.ai',
      web_base: 'https://reelmind.ai',
      google_client_id: '',
    },
    database: { path: './data/reelmind.db' },
    polling: {
      interval: 5000,
      max_retries: 120,
      token_refresh_margin: 300,
    },
  },
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => 'admin_key: test'),
  }
})

vi.mock('js-yaml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('js-yaml')>()
  return {
    ...actual,
    load: vi.fn(() => configState.current),
  }
})

describe('config utilities', () => {
  beforeEach(async () => {
    const { resetConfigCache } = await import('../server/utils/config')
    resetConfigCache()
    configState.current = {
      ...configState.current,
      admin_key: 'admin-secret',
    }
  })

  it('does not validate blank admin keys against blank or nonblank config', async () => {
    const { validateAdminKey, resetConfigCache } =
      await import('../server/utils/config')

    expect(validateAdminKey('')).toBe(false)

    configState.current = {
      ...configState.current,
      admin_key: '',
    }
    resetConfigCache()

    expect(validateAdminKey('')).toBe(false)
    expect(validateAdminKey('   ')).toBe(false)
  })
})
