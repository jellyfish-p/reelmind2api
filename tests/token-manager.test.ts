import { beforeEach, describe, expect, it, vi } from 'vitest'

const pollState = vi.hoisted(() => ({
  taskUpdates: [] as Array<Record<string, any>>,
  apiTokenUpdates: [] as Array<Record<string, any>>,
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
          all: vi.fn(() => (table === schema.tasks ? [pollState.activeTask] : [])),
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
})
