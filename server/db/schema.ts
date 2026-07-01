import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name'),
  googleSub: text('google_sub').unique(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: integer('token_expires_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const apiTokens = sqliteTable('api_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  quota: integer('quota').notNull().default(1000),
  used: integer('used').notNull().default(0),
  rateLimit: integer('rate_limit').notNull().default(60),
  enabled: integer('enabled').notNull().default(1),
  lastUsedAt: integer('last_used_at'),
  createdAt: integer('created_at').notNull(),
})

export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: text('task_id').notNull().unique(),
  object: text('object').notNull().default('task'),
  model: text('model').notNull(),
  type: text('type').notNull(),
  prompt: text('prompt'),
  negativePrompt: text('negative_prompt'),
  imageUrl: text('image_url'),
  aspectRatio: text('aspect_ratio'),
  duration: integer('duration'),
  resolution: text('resolution'),
  parameters: text('parameters'),
  status: text('status').notNull().default('pending'),
  progress: integer('progress').default(0),
  resultUrl: text('result_url'),
  resultData: text('result_data'),
  errorMessage: text('error_message'),
  reelmindTaskId: text('reelmind_task_id'),
  apiTokenId: integer('api_token_id').references(() => apiTokens.id),
  accountId: integer('account_id').references(() => accounts.id),
  creditsUsed: real('credits_used'),
  pollCount: integer('poll_count').default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  completedAt: integer('completed_at'),
})

export type Account = typeof accounts.$inferSelect
export type NewAccount = typeof accounts.$inferInsert
export type ApiToken = typeof apiTokens.$inferSelect
export type NewApiToken = typeof apiTokens.$inferInsert
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
