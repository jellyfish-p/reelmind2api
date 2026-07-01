import { authenticateApiKey } from '../../../../utils/api-auth'
import { getDb, schema } from '../../../../db'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const auth = await authenticateApiKey(event)
  if (!auth) {
    setResponseStatus(event, 401)
    return { error: { message: 'Invalid API key', type: 'authentication_error', code: 401 } }
  }

  const id = getRouterParam(event, 'id')
  if (!id) {
    setResponseStatus(event, 400)
    return { error: { message: 'Task ID is required', type: 'invalid_request_error', code: 400 } }
  }

  const db = getDb()
  const task = db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.taskId, id))
    .get()

  if (!task) {
    setResponseStatus(event, 404)
    return { error: { message: 'Task not found', type: 'not_found_error', code: 404 } }
  }

  const result: any = {
    id: task.taskId,
    object: task.object,
    created: task.createdAt ? Math.floor(task.createdAt / 1000) : 0,
    model: task.model,
    status: task.status,
    progress: task.progress,
    error: task.errorMessage ? { message: task.errorMessage } : undefined,
  }

  if (task.status === 'succeeded' || task.status === 'completed') {
    result.data = task.resultUrl
      ? [{ url: task.resultUrl, revised_prompt: task.prompt }]
      : []
  }

  return result
})
