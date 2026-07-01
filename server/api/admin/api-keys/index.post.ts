import { adminError, requireAdmin } from '../../../utils/admin-response'
import {
  createApiKey,
  isApiKeyConfigError,
} from '../../../utils/admin-config'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError

  try {
    const body = await readBody(event)
    return createApiKey(body)
  } catch (error: any) {
    if (!isApiKeyConfigError(error)) throw error
    return adminError(event, error.status, error.message, error.code)
  }
})
