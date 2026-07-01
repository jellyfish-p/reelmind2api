import { adminError, requireAdmin } from '../../../utils/admin-response'
import {
  deleteApiKey,
  isApiKeyConfigError,
} from '../../../utils/admin-config'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError

  try {
    return deleteApiKey(decodedRouteKey(event))
  } catch (error: any) {
    if (!isApiKeyConfigError(error)) throw error
    return adminError(event, error.status, error.message, error.code)
  }
})

function decodedRouteKey(event: any): string {
  const routeKey = getRouterParam(event, 'key') ?? ''
  try {
    return decodeURIComponent(routeKey)
  } catch {
    return routeKey
  }
}
