import { eq } from 'drizzle-orm'
import {
  adminDatabaseError,
  adminError,
  requireAdmin,
} from '../../../utils/admin-response'
import { parseAccountId, sanitizeAccount } from '../../../utils/admin-accounts'
import { getDb, schema } from '../../../db'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError

  const id = parseAccountId(getRouterParam(event, 'id'))
  if (id === null) {
    return adminError(event, 404, 'Account not found', 'account_not_found')
  }

  try {
    const db = getDb()
    const account = db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, id))
      .get()

    if (!account) {
      return adminError(event, 404, 'Account not found', 'account_not_found')
    }

    const tasks = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.accountId, id))
      .all()

    return sanitizeAccount(account as any, tasks as any[])
  } catch {
    return adminDatabaseError(event)
  }
})
