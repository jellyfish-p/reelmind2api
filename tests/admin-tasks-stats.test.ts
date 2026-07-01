import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RouteHandler = (event: any) => Promise<unknown>

const state = vi.hoisted(() => ({
  validAdmin: true,
  tasks: [] as Array<Record<string, any>>,
  accounts: [] as Array<Record<string, any>>,
  apiKeys: [] as Array<Record<string, any>>,
  operations: [] as Array<Record<string, any>>,
}))

vi.mock('../server/utils/api-auth', () => ({
  authenticateAdmin: vi.fn(async () => state.validAdmin),
}))

vi.mock('../server/utils/config', () => ({
  loadConfig: vi.fn(() => ({
    api_keys: state.apiKeys,
  })),
}))

vi.mock('drizzle-orm', () => {
  function condition(
    op: string,
    column: { key: string },
    value: unknown,
    matches: (row: Record<string, any>) => boolean,
  ) {
    return Object.assign(matches, {
      meta: { op, key: column.key, value },
    })
  }

  return {
    and: vi.fn((...conditions: Array<any>) => {
      const activeConditions = conditions.filter(Boolean)
      return Object.assign(
        (row: Record<string, any>) =>
          activeConditions.every((predicate) => predicate(row)),
        {
          meta: {
            op: 'and',
            conditions: activeConditions.map((predicate) => predicate.meta),
          },
        },
      )
    }),
    count: vi.fn(() => ({ kind: 'count' })),
    desc: vi.fn((column: { key: string }) => ({
      direction: 'desc',
      key: column.key,
    })),
    eq: vi.fn((column: { key: string }, value: unknown) =>
      condition(
        'eq',
        column,
        value,
        (row: Record<string, any>) => row[column.key] === value,
      ),
    ),
    gte: vi.fn((column: { key: string }, value: unknown) =>
      condition(
        'gte',
        column,
        value,
        (row: Record<string, any>) => row[column.key] >= value,
      ),
    ),
    lte: vi.fn((column: { key: string }, value: unknown) =>
      condition(
        'lte',
        column,
        value,
        (row: Record<string, any>) => row[column.key] <= value,
      ),
    ),
  }
})

vi.mock('../server/db', () => {
  const schema = {
    accounts: {
      id: { key: 'id' },
      tokenExpiresAt: { key: 'tokenExpiresAt' },
    },
    tasks: {
      id: { key: 'id' },
      taskId: { key: 'taskId' },
      status: { key: 'status' },
      type: { key: 'type' },
      model: { key: 'model' },
      accountId: { key: 'accountId' },
      apiTokenId: { key: 'apiTokenId' },
      createdAt: { key: 'createdAt' },
    },
  }

  function rowsFor(table: any) {
    if (table === schema.accounts) return state.accounts
    if (table === schema.tasks) return state.tasks
    throw new Error('Unexpected table in admin task test')
  }

  function tableName(table: any) {
    if (table === schema.accounts) return 'accounts'
    if (table === schema.tasks) return 'tasks'
    return 'unknown'
  }

  function createSelectBuilder(selection?: Record<string, any>) {
    let selectedTable: any
    let predicate: ((row: Record<string, any>) => boolean) | undefined
    let orders: Array<{ direction: string; key: string }> = []
    let selectedLimit: number | undefined
    let selectedOffset = 0

    function filteredRows() {
      const rows = predicate
        ? rowsFor(selectedTable).filter((row) => predicate?.(row))
        : [...rowsFor(selectedTable)]

      if (orders.length > 0) {
        rows.sort((left, right) => {
          for (const order of orders) {
            if (left[order.key] === right[order.key]) continue
            if (order.direction === 'desc') {
              return left[order.key] > right[order.key] ? -1 : 1
            }
            return left[order.key] > right[order.key] ? 1 : -1
          }
          return 0
        })
      }

      const start = selectedOffset
      const end =
        selectedLimit === undefined ? undefined : selectedOffset + selectedLimit
      return rows.slice(start, end)
    }

    const builder = {
      from: vi.fn((table: any) => {
        selectedTable = table
        return builder
      }),
      where: vi.fn((condition: (row: Record<string, any>) => boolean) => {
        predicate = condition
        state.operations.push({ type: 'where', meta: (condition as any).meta })
        return builder
      }),
      orderBy: vi.fn((...selectedOrders: Array<{ direction: string; key: string }>) => {
        orders = selectedOrders
        state.operations.push({ type: 'orderBy', orders })
        return builder
      }),
      limit: vi.fn((value: number) => {
        selectedLimit = value
        state.operations.push({ type: 'limit', value })
        return builder
      }),
      offset: vi.fn((value: number) => {
        selectedOffset = value
        state.operations.push({ type: 'offset', value })
        return builder
      }),
      all: vi.fn(() => {
        state.operations.push({
          type: 'all',
          table: tableName(selectedTable),
          filtered: Boolean(predicate),
          ordered: orders.length > 0,
          limit: selectedLimit,
          offset: selectedOffset,
        })
        return filteredRows()
      }),
      get: vi.fn(() => {
        state.operations.push({
          type: 'get',
          table: tableName(selectedTable),
          filtered: Boolean(predicate),
          selection: selection?.total?.kind === 'count' ? 'count' : 'row',
        })
        if (selection?.total?.kind === 'count') {
          const rows = predicate
            ? rowsFor(selectedTable).filter((row) => predicate?.(row))
            : rowsFor(selectedTable)
          return { total: rows.length }
        }
        return filteredRows()[0]
      }),
    }

    return builder
  }

  const db = {
    select: vi.fn((selection?: Record<string, any>) => createSelectBuilder(selection)),
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
    state.accounts = []
    state.apiKeys = []
    state.operations = []
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
          id: 2,
          taskId: 'task-public-2',
          object: 'image.generation',
          model: 'reelmind-image-v1',
          type: 'image',
          prompt: 'A neon market in the rain',
          status: 'completed',
          progress: 100,
          resultUrl: 'https://cdn.example.test/market.png',
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
      ],
      pagination: { page: 1, limit: 1, total: 2 },
    })
    expect(state.operations).toContainEqual(
      expect.objectContaining({
        type: 'orderBy',
        orders: [
          { direction: 'desc', key: 'createdAt' },
          { direction: 'desc', key: 'id' },
        ],
      }),
    )
    expect(state.operations).toContainEqual({ type: 'limit', value: 1 })
    expect(state.operations).toContainEqual({ type: 'offset', value: 0 })
    expect((result as any).data[0]).not.toHaveProperty('parameters')
    expect((result as any).data[0]).not.toHaveProperty('resultData')
  })

  it('orders newest first with id tie-break and paginates page 2', async () => {
    const base = taskRows()[0]
    state.tasks = [
      { ...base, id: 1, taskId: 'oldest', createdAt: 100, updatedAt: 100 },
      { ...base, id: 4, taskId: 'tie-low', createdAt: 300, updatedAt: 300 },
      { ...base, id: 5, taskId: 'tie-high', createdAt: 300, updatedAt: 300 },
      { ...base, id: 6, taskId: 'newest', createdAt: 400, updatedAt: 400 },
    ]
    const handler = await loadRoute('../server/api/admin/tasks/index.get')

    const page1 = await handler({ query: { page: '1', limit: '2' } })
    state.operations = []
    const page2 = await handler({ query: { page: '2', limit: '2' } })

    expect((page1 as any).data.map((task: any) => task.taskId)).toEqual([
      'newest',
      'tie-high',
    ])
    expect(page2).toMatchObject({
      data: [{ taskId: 'tie-low' }, { taskId: 'oldest' }],
      pagination: { page: 2, limit: 2, total: 4 },
    })
    expect(state.operations).toContainEqual({ type: 'limit', value: 2 })
    expect(state.operations).toContainEqual({ type: 'offset', value: 2 })
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
    expect(state.operations.some((operation) => operation.type === 'where')).toBe(
      true,
    )
    expect(state.operations).toContainEqual({ type: 'limit', value: 20 })
    expect(state.operations).toContainEqual({ type: 'offset', value: 0 })
  })

  it('does not floor decimal account id filters into matches', async () => {
    const handler = await loadRoute('../server/api/admin/tasks/index.get')

    const result = await handler({ query: { account_id: '7.9' } })

    expect(result).toEqual({
      data: [],
      pagination: { page: 1, limit: 20, total: 0 },
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
    expect(state.operations).toContainEqual(
      expect.objectContaining({
        type: 'where',
        meta: { op: 'eq', key: 'taskId', value: '2' },
      }),
    )
    expect(state.operations).toContainEqual(
      expect.objectContaining({
        type: 'where',
        meta: { op: 'eq', key: 'id', value: 2 },
      }),
    )
    expect(state.operations.some((operation) => operation.type === 'all')).toBe(
      false,
    )
  })

  it('prefers exact public task ids over numeric local ids', async () => {
    const [localTask, publicNumericTask] = taskRows()
    state.tasks = [
      { ...localTask, id: 1, taskId: 'local-id-1' },
      { ...publicNumericTask, id: 99, taskId: '1', prompt: 'Public numeric id' },
    ]
    const handler = await loadRoute('../server/api/admin/tasks/[id].get')

    const result = await handler({ params: { id: '1' } })

    expect(result).toMatchObject({
      id: 99,
      taskId: '1',
      prompt: 'Public numeric id',
    })
    expect(state.operations).toContainEqual(
      expect.objectContaining({
        type: 'where',
        meta: { op: 'eq', key: 'taskId', value: '1' },
      }),
    )
    expect(state.operations).not.toContainEqual(
      expect.objectContaining({
        type: 'where',
        meta: { op: 'eq', key: 'id', value: 1 },
      }),
    )
    expect(state.operations.some((operation) => operation.type === 'all')).toBe(
      false,
    )
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

describe('admin stats API', () => {
  const now = 1_700_200_000_000

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(now)
    state.validAdmin = true
    state.tasks = [
      {
        id: 1,
        status: 'completed',
        type: 'video',
        creditsUsed: 3,
        createdAt: now - 1_000,
      },
      {
        id: 2,
        status: 'failed',
        type: 'image',
        creditsUsed: 1.5,
        createdAt: now - 60_000,
      },
      {
        id: 3,
        status: 'completed',
        type: 'video',
        creditsUsed: null,
        createdAt: now - 86_400_001,
      },
    ]
    state.accounts = [
      { id: 1, tokenExpiresAt: now - 1 },
      { id: 2, tokenExpiresAt: now + 60_000 },
      { id: 3, tokenExpiresAt: null },
    ]
    state.apiKeys = [
      { key: 'sk-one', name: 'One' },
      { key: 'sk-two', name: 'Two' },
    ]
    state.operations = []
    vi.stubGlobal('defineEventHandler', (handler: RouteHandler) => handler)
    vi.stubGlobal('setResponseStatus', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns dashboard totals for tasks, accounts, and API keys', async () => {
    const handler = await loadRoute('../server/api/admin/stats.get')

    const result = await handler({})

    expect(result).toEqual({
      tasks: {
        total: 3,
        recent: 2,
        byStatus: {
          completed: 2,
          failed: 1,
        },
        byType: {
          video: 2,
          image: 1,
        },
        totalCreditsUsed: 4.5,
      },
      accounts: {
        total: 3,
        expiredTokens: 1,
      },
      apiKeys: {
        total: 2,
      },
    })
    expect(state.operations).toContainEqual(
      expect.objectContaining({ type: 'all', table: 'tasks' }),
    )
    expect(state.operations).toContainEqual(
      expect.objectContaining({ type: 'all', table: 'accounts' }),
    )
  })

  it('rejects stats reads without a valid admin key', async () => {
    state.validAdmin = false
    const handler = await loadRoute('../server/api/admin/stats.get')
    const event = {}

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
