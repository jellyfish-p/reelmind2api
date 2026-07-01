import { requireAdmin } from '../../../utils/admin-response'
import { sanitizeAccount } from '../../../utils/admin-accounts'
import { getDb, schema } from '../../../db'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError

  const db = getDb()
  const accounts = db.select().from(schema.accounts).all()
  const tasks = db.select().from(schema.tasks).all()

  return {
    data: accounts.map((account: any) =>
      sanitizeAccount(
        account,
        tasks.filter((task: any) => task.accountId === account.id),
      ),
    ),
  }
})
