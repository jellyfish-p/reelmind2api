import { beforeEach, describe, expect, it, vi } from 'vitest'

const pollState = vi.hoisted(() => ({
  taskUpdates: [] as Array<Record<string, any>>,
  apiTokenUpdates: [] as Array<Record<string, any>>,
  accountUpdates: [] as Array<Record<string, any>>,
  account: {
    id: 1,
    accessToken: 'upstream-access-token',
  },
  activeTask: {
    id: 10,
    reelmindTaskId: 'rm-task-123',
    pollCount: 0,
    progress: 0,
    accountId: 1,
    apiTokenId: 42,
  },
  activeTasks: [] as Array<Record<string, any>>,
  expiringAccounts: [] as Array<Record<string, any>>,
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  lt: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}))

vi.mock('../server/utils/config', () => ({
  loadConfig: vi.fn(() => ({
    polling: {
      interval: 60000,
      max_retries: 120,
      token_refresh_margin: 300,
    },
    reelmind: {
      api_base: 'https://api.example.test',
      web_base: 'https://web.example.test',
      google_client_id: '',
    },
  })),
}))

vi.mock('../server/db', () => {
  const schema = {
    tasks: {
      id: { name: 'id' },
      status: { name: 'status' },
      pollCount: { name: 'poll_count' },
      reelmindTaskId: { name: 'reelmind_task_id' },
    },
    accounts: {
      id: { name: 'id' },
      refreshToken: { name: 'refresh_token' },
      tokenExpiresAt: { name: 'token_expires_at' },
    },
    apiTokens: {
      id: { name: 'id' },
    },
  }

  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({
          all: vi.fn(() => {
            if (table === schema.tasks) return pollState.activeTasks
            if (table === schema.accounts) return pollState.expiringAccounts
            return []
          }),
          get: vi.fn(() => (table === schema.accounts ? pollState.account : undefined)),
        })),
      })),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, any>) => ({
        where: vi.fn(() => ({
          run: vi.fn(() => {
            if (table === schema.tasks) {
              pollState.taskUpdates.push(values)
            }
            if (table === schema.apiTokens) {
              pollState.apiTokenUpdates.push(values)
            }
            if (table === schema.accounts) {
              pollState.accountUpdates.push(values)
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

describe('token polling', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    pollState.taskUpdates = []
    pollState.apiTokenUpdates = []
    pollState.accountUpdates = []
    pollState.activeTasks = [pollState.activeTask]
    pollState.expiringAccounts = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              status: 'completed',
              result_url: 'https://result.example.test/video.mp4',
              credits_used: 7,
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    )
  })

  it('stores nested completion data without adding usage a second time', async () => {
    const { startTokenPolling, stopTokenPolling } = await import(
      '../server/utils/token-manager'
    )

    await startTokenPolling()
    stopTokenPolling()

    const completedUpdate = pollState.taskUpdates.find(
      (update) => update.status === 'completed',
    )
    expect(completedUpdate).toMatchObject({
      status: 'completed',
      resultUrl: 'https://result.example.test/video.mp4',
      creditsUsed: 7,
      progress: 100,
    })
    expect(pollState.apiTokenUpdates).toHaveLength(0)
  })

  it('refreshes expiring Supabase account tokens with the Supabase auth endpoint', async () => {
    const now = new Date('2026-07-01T00:00:00Z')
    vi.setSystemTime(now)
    pollState.activeTasks = []
    pollState.expiringAccounts = [
      {
        id: 2,
        accessToken: jwt({
          iss: 'https://ucljsqjaggrhupdayakz.supabase.co/auth/v1',
          exp: 1782896787,
        }),
        refreshToken: 'old-refresh-token',
        tokenExpiresAt: now.getTime() - 1000,
      },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            access_token: 'new-supabase-access-token',
            refresh_token: 'new-supabase-refresh-token',
            expires_in: 3600,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    )
    const { startTokenPolling, stopTokenPolling } = await import(
      '../server/utils/token-manager'
    )

    await startTokenPolling()
    stopTokenPolling()

    expect(fetch).toHaveBeenCalledWith(
      'https://ucljsqjaggrhupdayakz.supabase.co/auth/v1/token?grant_type=refresh_token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          apikey: expect.stringContaining('sb_publishable_'),
        }),
        body: JSON.stringify({ refresh_token: 'old-refresh-token' }),
      }),
    )
    expect(pollState.accountUpdates[0]).toMatchObject({
      accessToken: 'new-supabase-access-token',
      refreshToken: 'new-supabase-refresh-token',
      tokenExpiresAt: now.getTime() + 3600_000,
      updatedAt: now.getTime(),
    })
  })
})

function jwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}
