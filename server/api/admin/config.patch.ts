import {
  adminError,
  adminInternalError,
  requireAdmin,
} from '../../utils/admin-response'
import { isConfigPatchError, patchConfig } from '../../utils/admin-config'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError

  try {
    const body = await readBody(event)
    return patchConfig(body)
  } catch (error: any) {
    if (isConfigPatchError(error)) {
      return adminError(event, 400, error.message, 'invalid_config_patch')
    }
    return adminInternalError(
      event,
      'Admin persistence failed',
      'admin_persistence_failed',
    )
  }
})
