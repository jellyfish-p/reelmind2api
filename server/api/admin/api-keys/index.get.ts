import { requireAdmin } from '../../../utils/admin-response'
import { listApiKeys } from '../../../utils/admin-config'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError

  return { data: listApiKeys() }
})
