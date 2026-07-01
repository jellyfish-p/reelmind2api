import { requireAdmin } from '../../utils/admin-response'
import { countBy, sumCredits } from '../../utils/admin-tasks'
import { loadConfig } from '../../utils/config'
import { getDb, schema } from '../../db'
import type { Account, Task } from '../../db/schema'

const RECENT_TASK_WINDOW_MS = 24 * 60 * 60 * 1000
type StatsTask = Pick<Task, 'createdAt' | 'status' | 'type' | 'creditsUsed'>
type StatsAccount = Pick<Account, 'tokenExpiresAt'>

export default defineEventHandler(async (event) => {
  const authError = await requireAdmin(event)
  if (authError) return authError

  const db = getDb()
  const tasks = db
    .select({
      createdAt: schema.tasks.createdAt,
      status: schema.tasks.status,
      type: schema.tasks.type,
      creditsUsed: schema.tasks.creditsUsed,
    })
    .from(schema.tasks)
    .all() as StatsTask[]
  const accounts = db
    .select({
      tokenExpiresAt: schema.accounts.tokenExpiresAt,
    })
    .from(schema.accounts)
    .all() as StatsAccount[]
  const apiKeys = loadConfig().api_keys
  const now = Date.now()
  const recentSince = now - RECENT_TASK_WINDOW_MS

  return {
    tasks: {
      total: tasks.length,
      recent: tasks.filter((task) => task.createdAt >= recentSince).length,
      byStatus: countBy(tasks, 'status'),
      byType: countBy(tasks, 'type'),
      totalCreditsUsed: sumCredits(tasks),
    },
    accounts: {
      total: accounts.length,
      expiredTokens: accounts.filter(
        (account) =>
          typeof account.tokenExpiresAt === 'number' &&
          account.tokenExpiresAt < now,
      ).length,
    },
    apiKeys: {
      total: Array.isArray(apiKeys) ? apiKeys.length : 0,
    },
  }
})
