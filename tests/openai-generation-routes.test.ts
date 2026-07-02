import { beforeEach, describe, expect, it, vi } from 'vitest'

type RouteHandler = (event: any) => Promise<unknown>

const routeMockState = vi.hoisted(() => ({
  account: {
    id: 1,
    accessToken: 'upstream-access-token',
  },
  reserveAccountForCredits: vi.fn(() => ({
    id: 1,
    accessToken: 'upstream-access-token',
  })),
  refundReservedCredits: vi.fn(),
  authenticateApiKey: vi.fn(async () => ({
    tokenId: 42,
    tokenKey: 'test-key',
    tokenName: 'Test Key',
  })),
  incrementUsage: vi.fn(async () => undefined),
  insertedTasks: [] as Array<Record<string, any>>,
}))

vi.mock('uncrypto', () => ({
  randomUUID: () => 'fixed-uuid',
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}))

vi.mock('../server/utils/api-auth', () => ({
  authenticateApiKey: routeMockState.authenticateApiKey,
  incrementUsage: routeMockState.incrementUsage,
}))

vi.mock('../server/utils/account-pool', () => ({
  reserveAccountForCredits: routeMockState.reserveAccountForCredits,
  refundReservedCredits: routeMockState.refundReservedCredits,
}))

vi.mock('../server/utils/config', () => ({
  loadConfig: vi.fn(() => ({
    reelmind: {
      api_base: 'https://api.example.test',
      web_base: 'https://web.example.test',
    },
  })),
}))

vi.mock('../server/db', () => {
  const schema = {
    accounts: {
      id: { name: 'id' },
    },
    tasks: {},
  }

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          get: vi.fn(() => routeMockState.account),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, any>) => ({
        run: vi.fn(() => {
          routeMockState.insertedTasks.push(values)
        }),
      })),
    })),
  }

  return {
    getDb: () => db,
    schema,
  }
})

async function loadVideoGenerationRoute(): Promise<RouteHandler> {
  const mod = await import('../server/api/v1/videos/generations.post')
  return mod.default
}

async function loadImageGenerationRoute(): Promise<RouteHandler> {
  const mod = await import('../server/api/v1/images/generations.post')
  return mod.default
}

async function loadImageEditRoute(): Promise<RouteHandler> {
  const mod = await import('../server/api/v1/images/edits.post')
  return mod.default
}

async function loadImageVariationRoute(): Promise<RouteHandler> {
  const mod = await import('../server/api/v1/images/variations.post')
  return mod.default
}

function fakeImageFile(type = 'image/png') {
  return {
    type,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  } as File
}

describe('OpenAI-compatible generation routes', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    routeMockState.insertedTasks = []
    routeMockState.account = {
      id: 1,
      accessToken: 'upstream-access-token',
    }
    routeMockState.reserveAccountForCredits.mockReturnValue({
      id: 1,
      accessToken: 'upstream-access-token',
    })
    routeMockState.refundReservedCredits.mockReset()
    routeMockState.authenticateApiKey.mockResolvedValue({
      tokenId: 42,
      tokenKey: 'test-key',
      tokenName: 'Test Key',
    })
    vi.stubGlobal('defineEventHandler', (handler: RouteHandler) => handler)
    vi.stubGlobal('readBody', async (event: any) => event.body)
    vi.stubGlobal('readFormData', async (event: any) => event.formData)
    vi.stubGlobal('setResponseStatus', vi.fn())
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ data: { task_id: 'rm-task-123' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
  })

  it('submits video generations to ReelMind with reserved cost and snake_case payload', async () => {
    const event = {
      body: {
        model: 'video-model',
        prompt: 'a cinematic city sunrise',
        negative_prompt: 'low quality',
        image: 'https://cdn.example.test/input.png',
        duration: 5,
        aspect_ratio: '16:9',
        resolution: '1080p',
        fps: 24,
      },
    }

    const handler = await loadVideoGenerationRoute()
    await handler(event)

    expect(routeMockState.authenticateApiKey).toHaveBeenCalledWith(event, 50)
    expect(routeMockState.reserveAccountForCredits).toHaveBeenCalledWith(50)
    expect(fetch).toHaveBeenCalledTimes(1)

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.example.test/generation/gen-video')
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer upstream-access-token',
        Referer: 'https://web.example.test',
      },
    })

    const payload = JSON.parse(init?.body as string)
    expect(payload).toMatchObject({
      model_id: 'video-model',
      prompt: 'a cinematic city sunrise',
      negative_prompt: 'low quality',
      gen_type: 'image-to-video',
      duration: 5,
      aspect_ratio: '16:9',
      resolution: '1080p',
      reference_image_urls: ['https://cdn.example.test/input.png'],
      fps: 24,
    })
    expect(payload).not.toHaveProperty('modelId')
    expect(payload).not.toHaveProperty('negativePrompt')
    expect(payload).not.toHaveProperty('imageUrl')
    expect(payload).not.toHaveProperty('type')

    expect(routeMockState.insertedTasks).toHaveLength(1)
    expect(routeMockState.insertedTasks[0]).toMatchObject({
      reelmindTaskId: 'rm-task-123',
      accountId: 1,
      parameters: JSON.stringify(payload),
    })
    expect(routeMockState.incrementUsage).toHaveBeenCalledWith(42, 50)
  })

  it('submits Seedance 2 mixed image video audio references in one video request', async () => {
    const event = {
      body: {
        model: 'seedance2',
        prompt: 'Use @Image1 for character, @Video1 for motion, and @Audio1 for rhythm',
        image: 'https://cdn.example.test/character.png',
        videoUrl: 'https://cdn.example.test/motion.mp4',
        audio_urls: ['https://cdn.example.test/music.wav'],
        duration: 10,
      },
    }

    const handler = await loadVideoGenerationRoute()
    await handler(event)

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const payload = JSON.parse(init?.body as string)
    expect(payload).toMatchObject({
      model_id: 'seedance2',
      gen_type: 'reference-to-video',
      reference_image_urls: ['https://cdn.example.test/character.png'],
      video_urls: ['https://cdn.example.test/motion.mp4'],
      audio_urls: ['https://cdn.example.test/music.wav'],
    })
    expect(routeMockState.insertedTasks[0].parameters).toBe(JSON.stringify(payload))
  })

  it('rejects Seedance 2 audio references that BytePlus does not accept', async () => {
    const event = {
      body: {
        model: 'seedance2',
        prompt: 'Use @Audio1 as background',
        audio_urls: ['https://gen-refer-img.reelmind.ai/user/background.flac'],
      },
    }

    const handler = await loadVideoGenerationRoute()
    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 400)
    expect(result).toMatchObject({
      error: {
        message: expect.stringContaining('Unsupported audio format'),
        type: 'invalid_request_error',
        code: 400,
      },
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(routeMockState.insertedTasks).toHaveLength(0)
    expect(routeMockState.incrementUsage).not.toHaveBeenCalled()
    expect(routeMockState.refundReservedCredits).not.toHaveBeenCalled()
  })

  it('does not save or charge a task when upstream submission fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad upstream', { status: 500 })),
    )
    const event = {
      body: {
        prompt: 'a cinematic city sunrise',
      },
    }

    const handler = await loadVideoGenerationRoute()
    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 502)
    expect(result).toMatchObject({
      error: {
        type: 'api_error',
        code: 502,
      },
    })
    expect(routeMockState.insertedTasks).toHaveLength(0)
    expect(routeMockState.incrementUsage).not.toHaveBeenCalled()
    expect(routeMockState.refundReservedCredits).toHaveBeenCalledWith(1, 10)
  })

  it('returns 503 without upstream submission when no account has enough credits', async () => {
    routeMockState.reserveAccountForCredits.mockReturnValueOnce(null)
    const event = {
      body: {
        prompt: 'a cinematic city sunrise',
      },
    }

    const handler = await loadVideoGenerationRoute()
    const result = await handler(event)

    expect(routeMockState.reserveAccountForCredits).toHaveBeenCalledWith(10)
    expect(setResponseStatus).toHaveBeenCalledWith(event, 503)
    expect(result).toMatchObject({
      error: {
        message: expect.stringContaining('No ReelMind account'),
        type: 'api_error',
        code: 'no_available_account',
      },
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(routeMockState.insertedTasks).toHaveLength(0)
    expect(routeMockState.incrementUsage).not.toHaveBeenCalled()
    expect(routeMockState.refundReservedCredits).not.toHaveBeenCalled()
  })

  it('does not save or charge a task when upstream omits a task id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const event = {
      body: {
        prompt: 'a cinematic city sunrise',
      },
    }

    const handler = await loadVideoGenerationRoute()
    const result = await handler(event)

    expect(setResponseStatus).toHaveBeenCalledWith(event, 502)
    expect(result).toMatchObject({
      error: {
        type: 'api_error',
        code: 502,
      },
    })
    expect(routeMockState.insertedTasks).toHaveLength(0)
    expect(routeMockState.incrementUsage).not.toHaveBeenCalled()
    expect(routeMockState.refundReservedCredits).toHaveBeenCalledWith(1, 10)
  })

  it('submits image generations with reserved cost and route-owned generation type', async () => {
    const event = {
      body: {
        model: 'image-model',
        prompt: 'a ceramic lamp',
        negative_prompt: 'text',
        gen_type: 'image-variation',
        size: '1024x1024',
      },
    }

    const handler = await loadImageGenerationRoute()
    await handler(event)

    expect(routeMockState.authenticateApiKey).toHaveBeenCalledWith(event, 5)
    expect(routeMockState.reserveAccountForCredits).toHaveBeenCalledWith(5)
    const [, init] = vi.mocked(fetch).mock.calls[0]
    const payload = JSON.parse(init?.body as string)
    expect(payload).toMatchObject({
      model_id: 'image-model',
      prompt: 'a ceramic lamp',
      negative_prompt: 'text',
      gen_type: 'text-to-image',
      resolution: '1024x1024',
    })
    expect(payload).not.toHaveProperty('modelId')
    expect(payload).not.toHaveProperty('negativePrompt')
    expect(payload).not.toHaveProperty('imageUrl')
    expect(payload).not.toHaveProperty('type')
    expect(routeMockState.insertedTasks[0]).toMatchObject({
      accountId: 1,
      parameters: JSON.stringify(payload),
    })
    expect(routeMockState.incrementUsage).toHaveBeenCalledWith(42, 5)
  })

  it('submits image edits and variations with route-owned generation types', async () => {
    const editEvent = {
      formData: new Map<string, any>([
        ['image', fakeImageFile()],
        ['mask', fakeImageFile()],
        ['prompt', 'replace the sky'],
        ['model', 'image-model'],
        ['size', '1536x1024'],
        ['n', '2'],
        ['negative_prompt', 'noise'],
      ]),
    }

    const editHandler = await loadImageEditRoute()
    await editHandler(editEvent)

    expect(routeMockState.authenticateApiKey).toHaveBeenLastCalledWith(
      editEvent,
      5,
    )
    expect(routeMockState.reserveAccountForCredits).toHaveBeenLastCalledWith(5)
    let [, init] = vi.mocked(fetch).mock.calls.at(-1)!
    let payload = JSON.parse(init?.body as string)
    expect(payload).toMatchObject({
      model_id: 'image-model',
      prompt: 'replace the sky',
      negative_prompt: 'noise',
      gen_type: 'image-edit',
      resolution: '1536x1024',
      n: 2,
    })
    expect(payload.reference_image_urls[0]).toMatch(/^data:image\/png;base64,/)
    expect(payload.mask_url).toMatch(/^data:image\/png;base64,/)
    expect(routeMockState.incrementUsage).toHaveBeenLastCalledWith(42, 5)

    const variationEvent = {
      formData: new Map<string, any>([
        ['image', fakeImageFile()],
        ['model', 'image-model'],
        ['size', '1024x1024'],
        ['n', '3'],
      ]),
    }

    const variationHandler = await loadImageVariationRoute()
    await variationHandler(variationEvent)

    expect(routeMockState.authenticateApiKey).toHaveBeenLastCalledWith(
      variationEvent,
      5,
    )
    expect(routeMockState.reserveAccountForCredits).toHaveBeenLastCalledWith(5)
    ;[, init] = vi.mocked(fetch).mock.calls.at(-1)!
    payload = JSON.parse(init?.body as string)
    expect(payload).toMatchObject({
      model_id: 'image-model',
      gen_type: 'image-variation',
      resolution: '1024x1024',
      n: 3,
    })
    expect(payload.reference_image_urls[0]).toMatch(/^data:image\/png;base64,/)
    expect(payload).not.toHaveProperty('modelId')
    expect(payload).not.toHaveProperty('imageUrl')
    expect(payload).not.toHaveProperty('type')
    expect(routeMockState.incrementUsage).toHaveBeenLastCalledWith(42, 5)
  })
})
