import type { AuthSession } from '../types/reelmind'

export const useReelmindApi = () => {
  const session = useState<AuthSession | null>('reelmind-session', () => null)
  const config = useRuntimeConfig()

  const headers = computed(() => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (session.value?.accessToken) {
      h['Authorization'] = `Bearer ${session.value.accessToken}`
    }
    return h
  })

  async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await $fetch<T>(`${config.public.apiBaseUrl}${path}`, {
      ...options,
      headers: { ...headers.value, ...options?.headers },
    })
    return response
  }

  function setSession(newSession: AuthSession) {
    session.value = newSession
  }

  function clearSession() {
    session.value = null
  }

  const getModels = (params?: { page?: number; limit?: number; source?: string; type?: string }) =>
    fetchApi(`/models/list`, { method: 'GET', query: params as Record<string, string> })

  const getImageToVideoModels = (params?: { page?: number; limit?: number }) =>
    fetchApi(`/models/image-to-video`, { method: 'GET', query: params as Record<string, string> })

  const getModelConfig = (body: unknown) =>
    fetchApi(`/models/config`, { method: 'POST', body })

  const getLegoModels = () =>
    fetchApi(`/models/lego`, { method: 'GET' })

  const getGenerationPrice = (body: unknown) =>
    fetchApi(`/generation/price`, { method: 'POST', body })

  const getPricingQuote = (body: unknown) =>
    fetchApi(`/pricing/quote`, { method: 'POST', body })

  return {
    session: readonly(session),
    setSession,
    clearSession,
    getModels,
    getImageToVideoModels,
    getModelConfig,
    getLegoModels,
    getGenerationPrice,
    getPricingQuote,
  }
}
