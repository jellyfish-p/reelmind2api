import { eq } from 'drizzle-orm'
import { adminError, requireAdmin } from '../../../utils/admin-response'
import {
  accountPatchValues,
  isAccountInputError,
  parseAccountId,
  sanitizeAccount,
} from '../../../utils/admin-accounts'
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
    const existing = db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, id))
      .get()

    if (!existing) {
      return adminError(event, 404, 'Account not found', 'account_not_found')
    }

    const body = await readBody(event)
    const values = accountPatchValues(body)
    db.update(schema.accounts)
      .set(values)
      .where(eq(schema.accounts.id, id))
      .run()

    const account = db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, id))
      .get()
    const tasks = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.accountId, id))
      .all()

    return sanitizeAccount((account ?? { ...existing, ...values }) as any, tasks as any[])
  } catch (error: any) {
    if (!isAccountInputError(error)) throw error
    return adminError(event, error.status, error.message, error.code)
  }
})
