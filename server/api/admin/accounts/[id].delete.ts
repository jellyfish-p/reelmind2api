import { eq } from 'drizzle-orm'
import { adminError, requireAdmin } from '../../../utils/admin-response'
import { parseAccountId } from '../../../utils/admin-accounts'
import { getDb, schema } from '../../../db'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError

  const id = parseAccountId(getRouterParam(event, 'id'))
  if (id === null) {
    return adminError(event, 404, 'Account not found', 'account_not_found')
  }

  const db = getDb()
  const account = db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.id, id))
    .get()

  if (!account) {
    return adminError(event, 404, 'Account not found', 'account_not_found')
  }

  db.transaction((tx: any) => {
    tx.update(schema.tasks)
      .set({ accountId: null })
      .where(eq(schema.tasks.accountId, id))
      .run()
    tx.delete(schema.accounts).where(eq(schema.accounts.id, id)).run()
  })

  return { deleted: true }
})
