import {
  adminDatabaseError,
  requireAdmin,
} from '../../../utils/admin-response'
import {
  paginationMetadata,
  parsePagination,
  parseTaskFilters,
  summarizeTask,
  type TaskFilters,
} from '../../../utils/admin-tasks'
import { getDb, schema } from '../../../db'
import { and, count, desc, eq, gte, lte } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError

  const query = getQuery(event)
  const filters = parseTaskFilters(query)
  const pagination = parsePagination(query)
  const where = taskFilterWhere(filters)

  try {
    const db = getDb()
    const countQuery = db.select({ total: count() }).from(schema.tasks) as any
    const totalRow = (where ? countQuery.where(where) : countQuery).get()

    const taskQuery = db.select().from(schema.tasks) as any
    const scopedTaskQuery = where ? taskQuery.where(where) : taskQuery
    const tasks = scopedTaskQuery
      .orderBy(desc(schema.tasks.createdAt), desc(schema.tasks.id))
      .limit(pagination.limit)
      .offset(pagination.offset)
      .all()

    return {
      data: tasks.map((task: any) => summarizeTask(task)),
      pagination: paginationMetadata(pagination, Number(totalRow?.total ?? 0)),
    }
  } catch {
    return adminDatabaseError(event)
  }
})

function taskFilterWhere(filters: TaskFilters) {
  const conditions: any[] = []

  if (filters.invalidIdFilter) conditions.push(eq(schema.tasks.id, -1))
  if (filters.status) conditions.push(eq(schema.tasks.status, filters.status))
  if (filters.type) conditions.push(eq(schema.tasks.type, filters.type))
  if (filters.model) conditions.push(eq(schema.tasks.model, filters.model))
  if (filters.accountId !== undefined) {
    conditions.push(eq(schema.tasks.accountId, filters.accountId))
  }
  if (filters.apiTokenId !== undefined) {
    conditions.push(eq(schema.tasks.apiTokenId, filters.apiTokenId))
  }
  if (filters.createdFrom !== undefined) {
    conditions.push(gte(schema.tasks.createdAt, filters.createdFrom))
  }
  if (filters.createdTo !== undefined) {
    conditions.push(lte(schema.tasks.createdAt, filters.createdTo))
  }

  return conditions.length > 0 ? and(...conditions) : undefined
}
