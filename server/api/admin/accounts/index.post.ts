import { eq } from 'drizzle-orm'
import { adminError, requireAdmin } from '../../../utils/admin-response'
import {
  accountValues,
  isAccountInputError,
  isUniqueAccountConstraintError,
  sanitizeAccount,
} from '../../../utils/admin-accounts'
import { getDb, schema } from '../../../db'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError

  try {
    const db = getDb()
    const body = await readBody(event)
    const values = accountValues(body)
    if (accountExists(db, values.email, values.googleSub)) {
      return duplicateAccountError(event)
    }

    const result = db.insert(schema.accounts).values(values).run() as any
    const insertedId = Number(result?.lastInsertRowid)
    const account = Number.isFinite(insertedId)
      ? db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, insertedId))
        .get()
      : db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.email, values.email))
        .get()

    return sanitizeAccount(account as any, [])
  } catch (error: any) {
    if (isUniqueAccountConstraintError(error)) {
      return duplicateAccountError(event)
    }
    if (!isAccountInputError(error)) throw error
    return adminError(event, error.status, error.message, error.code)
  }
})

function accountExists(
  db: any,
  email: string,
  googleSub: string | null | undefined,
): boolean {
  if (
    db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.email, email))
      .get()
  ) {
    return true
  }

  if (!googleSub) return false
  return !!db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.googleSub, googleSub))
    .get()
}

function duplicateAccountError(event: any) {
  return adminError(event, 409, 'Account already exists', 'duplicate_account')
}
