import { eq } from 'drizzle-orm'
import {
  adminError,
  adminInternalError,
  requireAdmin,
} from '../../../utils/admin-response'
import {
  accountPatchValues,
  isAccountInputError,
  isUniqueAccountConstraintError,
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
    if (accountExists(db, values, id)) {
      return duplicateAccountError(event)
    }

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
    if (isUniqueAccountConstraintError(error)) {
      return duplicateAccountError(event)
    }
    if (isAccountInputError(error)) {
      return adminError(event, error.status, error.message, error.code)
    }
    return adminInternalError(
      event,
      'Admin database operation failed',
      'admin_database_failed',
    )
  }
})

function accountExists(
  db: any,
  values: Record<string, any>,
  currentId: number,
): boolean {
  if (
    values.email !== undefined &&
    hasOtherAccount(
      db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.email, values.email))
        .get(),
      currentId,
    )
  ) {
    return true
  }

  if (
    values.googleSub &&
    hasOtherAccount(
      db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.googleSub, values.googleSub))
        .get(),
      currentId,
    )
  ) {
    return true
  }

  return false
}

function hasOtherAccount(account: any, currentId: number): boolean {
  return !!account && account.id !== currentId
}

function duplicateAccountError(event: any) {
  return adminError(event, 409, 'Account already exists', 'duplicate_account')
}
