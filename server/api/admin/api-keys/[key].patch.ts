import {
  adminError,
  adminInternalError,
  requireAdmin,
} from '../../../utils/admin-response'
import {
  isApiKeyConfigError,
  updateApiKey,
} from '../../../utils/admin-config'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError

  try {
    const body = await readBody(event)
    return updateApiKey(decodedRouteKey(event), body)
  } catch (error: any) {
    if (isApiKeyConfigError(error)) {
      return adminError(event, error.status, error.message, error.code)
    }
    return adminInternalError(
      event,
      'Admin persistence failed',
      'admin_persistence_failed',
    )
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
