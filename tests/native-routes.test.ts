import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMock = vi.hoisted(() => ({
  getBearerToken: vi.fn(() => 'bearer-token'),
  nestGet: vi.fn(async () => ({ success: true })),
  nestPost: vi.fn(async () => ({ success: true })),
  toQueryParams: vi.fn((
    query: Record<string, unknown>,
    numericKeys: string[] = [],
  ) => {
    const params: Record<string, string | number> = {}
    const numericKeySet = new Set(numericKeys)

    for (const [key, value] of Object.entries(query || {})) {
      const scalarValue = Array.isArray(value) ? value[0] : value
      if (scalarValue === undefined || scalarValue === null) continue

      const stringValue = String(scalarValue)
      if (numericKeySet.has(key)) {
        const numericValue = Number(stringValue)
        params[key] = Number.isFinite(numericValue) ? numericValue : stringValue
      } else {
        params[key] = stringValue
      }
    }

    return params
  }),
}))

vi.mock('../server/utils/reelmind-client', () => clientMock)

type RouteHandler = (event: any) => Promise<unknown>

const routeImports = {
  modelsList: () => import('../server/api/models/list.get'),
  modelsImageToVideo: () => import('../server/api/models/image-to-video.get'),
  modelsById: () => import('../server/api/models/[id].get'),
  modelsSearch: () => import('../server/api/models/search.get'),
  modelsConfig: () => import('../server/api/models/config.post'),
  modelsLegoAlias: () => import('../server/api/models/lego.get'),
  generationPrice: () => import('../server/api/generation/price.post'),
  generationGenVideo: () => import('../server/api/generation/gen-video.post'),
  generationTaskById: () => import('../server/api/generation/task/[id].get'),
  pricingQuote: () => import('../server/api/pricing/quote.post'),
  legoModels: () => import('../server/api/lego/models.get'),
  legoGenPic: () => import('../server/api/lego/gen-pic.post'),
  legoTaskById: () => import('../server/api/lego/task/[id].get'),
  legoQueueInfoById: () => import('../server/api/lego/task/queue-info/[id].get'),
}

async function loadRoute(
  importer: () => Promise<{ default: RouteHandler }>,
): Promise<RouteHandler> {
  const mod = await importer()
  return mod.default
}

describe('native ReelMind proxy routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('defineEventHandler', (handler: RouteHandler) => handler)
    vi.stubGlobal('getQuery', (event: any) => event.query || {})
    vi.stubGlobal('getRouterParam', (event: any, name: string) => (
      event.params?.[name]
    ))
    vi.stubGlobal('readBody', async (event: any) => event.body)
  })

  it('maps models routes to the inferred upstream endpoints', async () => {
    await (await loadRoute(routeImports.modelsList))({
      query: { page: '2', type: 'image-to-video' },
    })
    expect(clientMock.nestGet).toHaveBeenLastCalledWith(
      '/models',
      expect.objectContaining({ page: 2, type: 'image-to-video' }),
      'bearer-token',
    )

    await (await loadRoute(routeImports.modelsImageToVideo))({
      query: { limit: '30' },
    })
    expect(clientMock.nestGet).toHaveBeenLastCalledWith(
      '/models',
      expect.objectContaining({
        limit: 30,
        source: 'new_arch,byteplus',
        type: 'image-to-video',
      }),
      'bearer-token',
    )

    await (await loadRoute(routeImports.modelsById))({
      params: { id: 'model/a b' },
    })
    expect(clientMock.nestGet).toHaveBeenLastCalledWith(
      '/models/model%2Fa%20b',
      undefined,
      'bearer-token',
    )

    await (await loadRoute(routeImports.modelsSearch))({
      query: { keyword: 'cat', page: '3' },
    })
    expect(clientMock.nestGet).toHaveBeenLastCalledWith(
      '/models/search',
      expect.objectContaining({ keyword: 'cat', page: 3 }),
      'bearer-token',
    )

    const configBody = { model_id: 'abc' }
    await (await loadRoute(routeImports.modelsConfig))({ body: configBody })
    expect(clientMock.nestPost).toHaveBeenLastCalledWith(
      '/models/config',
      configBody,
      'bearer-token',
    )
  })

  it('maps generation and pricing routes to the inferred upstream endpoints', async () => {
    const videoBody = { model_id: 'video-model', prompt: 'cat' }
    await (await loadRoute(routeImports.generationGenVideo))({ body: videoBody })
    expect(clientMock.nestPost).toHaveBeenLastCalledWith(
      '/generation/gen-video',
      videoBody,
      'bearer-token',
    )

    await (await loadRoute(routeImports.generationTaskById))({
      params: { id: 'task/a b' },
    })
    expect(clientMock.nestGet).toHaveBeenLastCalledWith(
      '/generation/task/task%2Fa%20b',
      undefined,
      'bearer-token',
    )

    const priceBody = { model_id: 'video-model', duration: 5 }
    await (await loadRoute(routeImports.generationPrice))({ body: priceBody })
    expect(clientMock.nestPost).toHaveBeenLastCalledWith(
      '/generation/task/price',
      priceBody,
      'bearer-token',
    )

    const quoteBody = { model_id: 'video-model' }
    await (await loadRoute(routeImports.pricingQuote))({ body: quoteBody })
    expect(clientMock.nestPost).toHaveBeenLastCalledWith(
      '/pricing/quote',
      quoteBody,
      'bearer-token',
    )
  })

  it('maps lego routes and the compatibility alias to the inferred upstream endpoints', async () => {
    await (await loadRoute(routeImports.modelsLegoAlias))({})
    expect(clientMock.nestGet).toHaveBeenLastCalledWith(
      '/lego/models',
      undefined,
      'bearer-token',
    )

    await (await loadRoute(routeImports.legoModels))({
      query: { page: '4' },
    })
    expect(clientMock.nestGet).toHaveBeenLastCalledWith(
      '/lego/models',
      expect.objectContaining({ page: 4 }),
      'bearer-token',
    )

    const genPicBody = { prompt: 'cat', model_id: 'lego-model' }
    await (await loadRoute(routeImports.legoGenPic))({ body: genPicBody })
    expect(clientMock.nestPost).toHaveBeenLastCalledWith(
      '/lego/gen-pic',
      genPicBody,
      'bearer-token',
    )

    await (await loadRoute(routeImports.legoTaskById))({
      params: { id: 'lego/a b' },
    })
    expect(clientMock.nestGet).toHaveBeenLastCalledWith(
      '/lego/task/lego%2Fa%20b',
      undefined,
      'bearer-token',
    )

    await (await loadRoute(routeImports.legoQueueInfoById))({
      params: { id: 'queue/a b' },
    })
    expect(clientMock.nestGet).toHaveBeenLastCalledWith(
      '/lego/task/queue-info/queue%2Fa%20b',
      undefined,
      'bearer-token',
    )
  })
})
