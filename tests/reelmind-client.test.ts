import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBearerToken, nestGet, nestPost } from '../server/utils/reelmind-client'

const mockConfig = vi.hoisted(() => ({
  apiBase: 'https://nest.example.test',
  webBase: 'https://app.example.test',
}))

vi.mock('../server/utils/config', () => ({
  loadConfig: vi.fn(() => ({
    reelmind: {
      api_base: mockConfig.apiBase,
      web_base: mockConfig.webBase,
    },
  })),
}))

describe('ReelMind client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('getHeader', (event: any, name: string) => {
      const headers = event.headers || {}
      return headers[name] ?? headers[name.toLowerCase()] ?? undefined
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
    )
  })

  it('sends GET requests to the configured API base with bearer auth and no legacy API key', async () => {
    await nestGet(
      '/models/search',
      { keyword: 'cat', page: 2, empty: undefined },
      'user-token',
    )

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://nest.example.test/models/search?keyword=cat&page=2')
    expect(init).toMatchObject({
      method: 'GET',
      headers: {
        Authorization: 'Bearer user-token',
        Referer: mockConfig.webBase,
        'Content-Type': 'application/json',
      },
    })
    expect((init?.headers as Record<string, string>)['X-API-Key']).toBeUndefined()
  })

  it('sends POST requests to the configured API base with the original JSON body', async () => {
    const body = { prompt: 'cat in a studio', modelId: 'video-model' }

    await nestPost('/generation/gen-video', body, 'user-token')

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://nest.example.test/generation/gen-video')
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify(body),
    })
  })

  it('extracts only Bearer authorization tokens', () => {
    expect(
      getBearerToken({ headers: { authorization: 'Bearer user-token' } }),
    ).toBe('user-token')
    expect(
      getBearerToken({ headers: { authorization: 'Basic ignored' } }),
    ).toBeUndefined()
  })
})
