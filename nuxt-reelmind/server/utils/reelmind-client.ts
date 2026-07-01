import type { ApiResponse } from '../../types/reelmind'

function getConfig() {
  const config = useRuntimeConfig()
  return {
    baseUrl: (config.nestApiBaseUrl as string) || 'https://nestapi.reelmind.ai',
    apiKey: (config.reelmindApiKey as string) || '',
  }
}

function buildHeaders(authToken?: string): Record<string, string> {
  const config = getConfig()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'ReelMind2API/1.0',
    'Referer': 'https://reelmind.ai/',
  }
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }
  if (config.apiKey) {
    headers['X-API-Key'] = config.apiKey
  }
  return headers
}

export async function nestGet<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  authToken?: string,
): Promise<ApiResponse<T>> {
  const url = new URL(path, getConfig().baseUrl)
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    }
  }
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: buildHeaders(authToken),
  })
  return handleResponse<T>(res)
}

export async function nestPost<T>(
  path: string,
  body: unknown,
  authToken?: string,
): Promise<ApiResponse<T>> {
  const url = new URL(path, getConfig().baseUrl)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: buildHeaders(authToken),
    body: JSON.stringify(body),
  })
  return handleResponse<T>(res)
}

async function handleResponse<T>(res: Response): Promise<ApiResponse<T>> {
  if (!res.ok) {
    const errorBody = await res.text().catch(() => '')
    return {
      success: false,
      error: `HTTP ${res.status}: ${res.statusText}. ${errorBody}`,
    }
  }
  try {
    const data = await res.json()
    return { success: true, data: data as T }
  } catch {
    return { success: true, data: undefined as unknown as T }
  }
}
