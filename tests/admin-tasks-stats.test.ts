import { beforeEach, describe, expect, it, vi } from 'vitest'

type RouteHandler = (event: any) => Promise<unknown>

const state = vi.hoisted(() => ({
  validAdmin: true,
  tasks: [] as Array<Record<string, any>>,
}))

vi.mock('../server/utils/api-auth', () => ({
  authenticateAdmin: vi.fn(async () => state.validAdmin),
}))

vi.mock('../server/db', () => {
  const schema = {
    tasks: {
      id: { key: 'id' },
      taskId: { key: 'taskId' },
    },
  }

  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: any) => ({
        all: vi.fn(() => (table === schema.tasks ? state.tasks : [])),
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

function taskRows() {
  return [
    {
      id: 1,
      taskId: 'task-public-1',
      object: 'video.generation',
      model: 'reelmind-video-v1',
      type: 'video',
      prompt: 'A cinematic harbor at sunrise',
      negativePrompt: 'low quality',
      imageUrl: 'https://input.example.test/harbor.png',
      aspectRatio: '16:9',
      duration: 5,
      resolution: '1080p',
      parameters: JSON.stringify({
        duration: 5,
        reference_image_urls: ['https://input.example.test/harbor.png'],
      }),
      status: 'completed',
      progress: 100,
      resultUrl: 'https://cdn.example.test/harbor.mp4',
      resultData: JSON.stringify({
        assets: [{ url: 'https://cdn.example.test/harbor.mp4' }],
        credits: 3,
      }),
      errorMessage: null,
      reelmindTaskId: 'rm-task-1',
      apiTokenId: 42,
      accountId: 7,
      creditsUsed: 3,
      pollCount: 4,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_010_000,
      completedAt: 1_700_000_020_000,
    },
    {
      id: 2,
      taskId: 'task-public-2',
      object: 'image.generation',
      model: 'reelmind-image-v1',
      type: 'image',
      prompt: 'A neon market in the rain',
      negativePrompt: null,
      imageUrl: null,
      aspectRatio: '1:1',
      duration: null,
      resolution: '1024x1024',
      parameters: JSON.stringify({ size: '1024x1024' }),
      status: 'completed',
      progress: 100,
      resultUrl: 'https://cdn.example.test/market.png',
      resultData: JSON.stringify({ url: 'https://cdn.example.test/market.png' }),
      errorMessage: null,
      reelmindTaskId: 'rm-task-2',
      apiTokenId: 42,
      accountId: 8,
      creditsUsed: 1,
      pollCount: 2,
      createdAt: 1_700_000_100_000,
      updatedAt: 1_700_000_110_000,
      completedAt: 1_700_000_120_000,
    },
    {
      id: 3,
      taskId: 'task-public-3',
      object: 'video.generation',
      model: 'reelmind-video-v1',
      type: 'video',
      prompt: 'A storm over a mountain pass',
      negativePrompt: null,
      imageUrl: null,
      aspectRatio: '9:16',
      duration: 10,
      resolution: '720p',
      parameters: null,
      status: 'failed',
      progress: 30,
      resultUrl: null,
      resultData: null,
      errorMessage: 'Upstream render failed',
      reelmindTaskId: 'rm-task-3',
      apiTokenId: 43,
      accountId: 7,
      creditsUsed: 0,
      pollCount: 5,
      createdAt: 1_700_000_200_000,
      updatedAt: 1_700_000_210_000,
      completedAt: null,
    },
  ]
}

describe('admin task logs API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    state.validAdmin = true
    state.tasks = taskRows()
    vi.stubGlobal('defineEventHandler', (handler: RouteHandler) => handler)
    vi.stubGlobal('setResponseStatus', vi.fn())
    vi.stubGlobal('getQuery', (event: any) => event.query ?? {})
    vi.stubGlobal(
      'getRouterParam',
      (event: any, name: string) => event.params?.[name],
    )
  })

  it('filters and paginates summarized task logs', async () => {
    const handler = await loadRoute('../server/api/admin/tasks/index.get')

    const result = await handler({
      query: { status: 'completed', page: '1', limit: '1' },
    })

    expect(result).toEqual({
      data: [
        {
          id: 1,
          taskId: 'task-public-1',
          object: 'video.generation',
          model: 'reelmind-video-v1',
          type: 'video',
          prompt: 'A cinematic harbor at sunrise',
          status: 'completed',
          progress: 100,
          resultUrl: 'https://cdn.example.test/harbor.mp4',
          errorMessage: null,
          reelmindTaskId: 'rm-task-1',
          apiTokenId: 42,
          accountId: 7,
          creditsUsed: 3,
          pollCount: 4,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_010_000,
          completedAt: 1_700_000_020_000,
        },
      ],
      pagination: { page: 1, limit: 1, total: 2 },
    })
    expect((result as any).data[0]).not.toHaveProperty('parameters')
    expect((result as any).data[0]).not.toHaveProperty('resultData')
  })

  it('applies model, type, account, token, and creation window filters', async () => {
    const handler = await loadRoute('../server/api/admin/tasks/index.get')

    const result = await handler({
      query: {
        model: 'reelmind-video-v1',
        type: 'video',
        account_id: '7',
        api_token_id: '43',
        created_from: '1700000190000',
        created_to: '1700000210000',
      },
    })

    expect(result).toMatchObject({
      data: [
        {
          id: 3,
          taskId: 'task-public-3',
          status: 'failed',
          errorMessage: 'Upstream render failed',
          reelmindTaskId: 'rm-task-3',
          apiTokenId: 43,
          accountId: 7,
        },
      ],
      pagination: { page: 1, limit: 20, total: 1 },
    })
  })

  it('returns task detail by public task id with parsed JSON fields', async () => {
    const handler = await loadRoute('../server/api/admin/tasks/[id].get')

    const result = await handler({ params: { id: 'task-public-1' } })

    expect(result).toMatchObject({
      id: 1,
      taskId: 'task-public-1',
      negativePrompt: 'low quality',
      imageUrl: 'https://input.example.test/harbor.png',
      aspectRatio: '16:9',
      duration: 5,
      resolution: '1080p',
      parameters: {
        duration: 5,
        reference_image_urls: ['https://input.example.test/harbor.png'],
      },
      resultData: {
        assets: [{ url: 'https://cdn.example.test/harbor.mp4' }],
        credits: 3,
      },
      errorMessage: null,
      reelmindTaskId: 'rm-task-1',
    })
  })

  it('returns task detail by local numeric id', async () => {
    const handler = await loadRoute('../server/api/admin/tasks/[id].get')

    const result = await handler({ params: { id: '2' } })

    expect(result).toMatchObject({
      id: 2,
      taskId: 'task-public-2',
      model: 'reelmind-image-v1',
      type: 'image',
      parameters: { size: '1024x1024' },
      resultData: { url: 'https://cdn.example.test/market.png' },
    })
  })

  it('returns 404 for missing task details', async () => {
    const handler = await loadRoute('../server/api/admin/tasks/[id].get')
    const event = { params: { id: 'missing-task' } }

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 404)
    expect(result).toEqual({
      error: {
        message: 'Task not found',
        code: 'task_not_found',
      },
    })
  })

  it('rejects task log reads without a valid admin key', async () => {
    state.validAdmin = false
    const handler = await loadRoute('../server/api/admin/tasks/index.get')
    const event = { query: {} }

    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 401)
    expect(result).toEqual({
      error: {
        message: 'Invalid admin key',
        code: 'invalid_admin_key',
      },
    })
  })
})
