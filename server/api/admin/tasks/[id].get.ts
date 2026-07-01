import {
  adminDatabaseError,
  adminError,
  requireAdmin,
} from '../../../utils/admin-response'
import { detailTask, parseLocalTaskId } from '../../../utils/admin-tasks'
import { getDb, schema } from '../../../db'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError

  const id = getRouterParam(event, 'id')
  if (!id) {
    return adminError(event, 404, 'Task not found', 'task_not_found')
  }

  try {
    const db = getDb()
    const publicTask = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.taskId, id))
      .get()

    if (publicTask) {
      return detailTask(publicTask as any)
    }

    const localId = parseLocalTaskId(id)
    if (localId === null) {
      return adminError(event, 404, 'Task not found', 'task_not_found')
    }

    const localTask = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, localId))
      .get()

    if (!localTask) {
      return adminError(event, 404, 'Task not found', 'task_not_found')
    }

    return detailTask(localTask as any)
  } catch {
    return adminDatabaseError(event)
  }
})
