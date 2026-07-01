import { adminError, requireAdmin } from '../../../utils/admin-response'
import { detailTask } from '../../../utils/admin-tasks'
import { getDb, schema } from '../../../db'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError

  const id = getRouterParam(event, 'id')
  if (!id) {
    return adminError(event, 404, 'Task not found', 'task_not_found')
  }

  const db = getDb()
  const tasks = db.select().from(schema.tasks).all()
  const task = tasks.find((row: any) => matchesTaskId(row, id))

  if (!task) {
    return adminError(event, 404, 'Task not found', 'task_not_found')
  }

  return detailTask(task as any)
})

function matchesTaskId(task: { id: number; taskId: string }, value: string): boolean {
  const localId = Number(value)
  if (Number.isInteger(localId) && localId > 0 && task.id === localId) {
    return true
  }

  return task.taskId === value
}
