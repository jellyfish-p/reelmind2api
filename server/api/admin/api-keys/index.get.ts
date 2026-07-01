import {
  adminPersistenceError,
  requireAdmin,
} from '../../../utils/admin-response'
import { listApiKeys } from '../../../utils/admin-config'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError

  try {
    return { data: listApiKeys() }
  } catch {
    return adminPersistenceError(event)
  }
})
