import { requireAdmin } from '../../../utils/admin-response'
import {
  matchesTaskFilters,
  paginate,
  parseTaskFilters,
  summarizeTask,
} from '../../../utils/admin-tasks'
import { getDb, schema } from '../../../db'

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError

  const query = getQuery(event)
  const filters = parseTaskFilters(query)
  const db = getDb()
  const tasks = db.select().from(schema.tasks).all()
  const filteredTasks = tasks.filter((task: any) =>
    matchesTaskFilters(task, filters),
  )
  const page = paginate(filteredTasks, query)

  return {
    data: page.items.map((task: any) => summarizeTask(task)),
    pagination: page.pagination,
  }
})
