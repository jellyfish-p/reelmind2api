import type { ApiResponse } from '../../types/reelmind'
import { loadConfig } from './config'

type QueryValue = string | number | null | undefined

const DEFAULT_API_BASE = 'https://nestapi.reelmind.ai'
const DEFAULT_WEB_BASE = 'https://reelmind.ai'

function getConfig() {
  const config = loadConfig()
  return {
    baseUrl: config.reelmind?.api_base || DEFAULT_API_BASE,
    webBase: config.reelmind?.web_base || DEFAULT_WEB_BASE,
  }
}

function buildHeaders(authToken?: string): Record<string, string> {
  const config = getConfig()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'ReelMind2API/1.0',
    'Referer': config.webBase,
  }
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }
  return headers
}

function buildUrl(path: string, params?: Record<string, QueryValue>): string {
  const config = getConfig()
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = new URL(`${baseUrl}${normalizedPath}`)

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    }
  }

  return url.toString()
}

export function getBearerToken(event: any): string | undefined {
  const authHeader = getHeader(event, 'authorization')
  if (!authHeader?.startsWith('Bearer ')) return undefined

  const token = authHeader.slice('Bearer '.length).trim()
  return token || undefined
}

export function toQueryParams(
  query: Record<string, unknown>,
  numericKeys: string[] = [],
): Record<string, string | number> {
  const params: Record<string, string | number> = {}
  const numericKeySet = new Set(numericKeys)

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue

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
}

export async function nestGet<T>(
  path: string,
  params?: Record<string, QueryValue>,
  authToken?: string,
): Promise<ApiResponse<T>> {
  const res = await fetch(buildUrl(path, params), {
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
  const res = await fetch(buildUrl(path), {
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
