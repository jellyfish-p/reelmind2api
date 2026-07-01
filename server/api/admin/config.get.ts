import { requireAdmin } from '../../utils/admin-response'
import { getSanitizedConfig } from '../../utils/admin-config'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError
  return getSanitizedConfig()
})
