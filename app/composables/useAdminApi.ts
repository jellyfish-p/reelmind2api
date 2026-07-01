export interface AdminErrorBody {
  error: { message: string; code: string }
}

export interface SanitizedApiKeyConfig {
  key: string | null
  name: string
  quota: number
  rate_limit: number
  enabled: boolean
}

export interface SanitizedAppConfig {
  server: { port: number; host: string }
  admin_key: string | null
  api_keys: SanitizedApiKeyConfig[]
  reelmind: { api_base: string; web_base: string; google_client_id: string }
  database: { path: string }
  polling: { interval: number; max_retries: number; token_refresh_margin: number }
}

export interface SanitizedAccount {
  id: number
  email: string
  name: string | null
  googleSub: string | null
  hasAccessToken: boolean
  accessTokenPreview: string | null
  hasRefreshToken: boolean
  refreshTokenPreview: string | null
  tokenExpiresAt: number | null
  tokenExpired: boolean
  taskCount: number
  createdAt: number
  updatedAt: number
  cookiePart0?: string | null
  cookiePart1?: string | null
  authorizationHeader?: string | null
}

export interface TaskSummary {
  id: number
  taskId: string
  object: string
  model: string
  type: string
  prompt: string | null
  status: string
  progress: number
  resultUrl: string | null
  errorMessage: string | null
  reelmindTaskId: string | null
  apiTokenId: number | null
  accountId: number | null
  creditsUsed: number | null
  pollCount: number
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

export interface TaskDetail extends TaskSummary {
  negativePrompt: string | null
  imageUrl: string | null
  aspectRatio: string | null
  duration: number | null
  resolution: string | null
  parameters: unknown
  resultData: unknown
}

export interface AdminStats {
  tasks: {
    total: number
    recent: number
    byStatus: Record<string, number>
    byType: Record<string, number>
    totalCreditsUsed: number
  }
  accounts: { total: number; expiredTokens: number }
  apiKeys: { total: number }
}

const STORAGE_KEY = 'reelmind_admin_key'

export function useAdminKey() {
  const key = useState<string>('admin_key', () => '')
  if (import.meta.client && !key.value) {
    key.value = localStorage.getItem(STORAGE_KEY) || ''
  }
  const setKey = (v: string) => {
    key.value = v
    if (import.meta.client) {
      if (v) localStorage.setItem(STORAGE_KEY, v)
      else localStorage.removeItem(STORAGE_KEY)
    }
  }
  const clearKey = () => setKey('')
  return { key, setKey, clearKey }
}

export function useAdminApi() {
  const { key, clearKey } = useAdminKey()

  async function request<T>(
    path: string,
    opts: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: any; query?: Record<string, any> } = {},
  ): Promise<T> {
    try {
      return await $fetch<T>(`/api/admin${path}`, {
        method: opts.method || 'GET',
        body: opts.body,
        query: opts.query,
        headers: key.value ? { 'X-Admin-Key': key.value } : {},
      })
    } catch (e: any) {
      const body = e?.response?._data as AdminErrorBody | undefined
      const code = body?.error?.code
      const message = body?.error?.message || e?.message || 'Request failed'
      if (code === 'invalid_admin_key' && import.meta.client) {
        clearKey()
        if (window.location.pathname !== '/admin/login') {
          navigateTo('/admin/login')
        }
      }
      const err = new Error(message) as Error & { code?: string; statusCode?: number }
      err.code = code
      err.statusCode = e?.response?.status
      throw err
    }
  }

  return {
    key,
    // stats
    getStats: () => request<AdminStats>('/stats'),
    // config
    getConfig: () => request<SanitizedAppConfig>('/config'),
    patchConfig: (patch: any) => request<SanitizedAppConfig>('/config', { method: 'PATCH', body: patch }),
    // api keys
    listApiKeys: () => request<{ data: SanitizedApiKeyConfig[] }>('/api-keys'),
    createApiKey: (input: any) => request<SanitizedApiKeyConfig>('/api-keys', { method: 'POST', body: input }),
    updateApiKey: (currentKey: string, patch: any) =>
      request<SanitizedApiKeyConfig>(`/api-keys/${encodeURIComponent(currentKey)}`, { method: 'PATCH', body: patch }),
    deleteApiKey: (currentKey: string) =>
      request<{ deleted: true }>(`/api-keys/${encodeURIComponent(currentKey)}`, { method: 'DELETE' }),
    // accounts
    listAccounts: () => request<{ data: SanitizedAccount[] }>('/accounts'),
    getAccount: (id: number) => request<SanitizedAccount>(`/accounts/${id}`),
    createAccount: (input: any) => request<SanitizedAccount>('/accounts', { method: 'POST', body: input }),
    updateAccount: (id: number, patch: any) =>
      request<SanitizedAccount>(`/accounts/${id}`, { method: 'PATCH', body: patch }),
    deleteAccount: (id: number) => request<{ deleted: true }>(`/accounts/${id}`, { method: 'DELETE' }),
    // tasks
    listTasks: (query: Record<string, any>) =>
      request<{ data: TaskSummary[]; pagination: { page: number; limit: number; total: number } }>('/tasks', { query }),
    getTask: (id: string | number) => request<TaskDetail>(`/tasks/${id}`),
  }
}
