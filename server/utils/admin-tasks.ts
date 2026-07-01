import type { Task } from '../db/schema'
import { positiveInt } from './admin-response'

type Query = Record<string, unknown>

export type TaskFilters = {
  status?: string
  type?: string
  model?: string
  accountId?: number
  apiTokenId?: number
  createdFrom?: number
  createdTo?: number
}

export type TaskSummary = {
  id: number
  taskId: string
  object: string
  model: string
  type: string
  prompt: string | null
  status: string
  progress: number
  resultUrl: string | null
  errorMessage: string | null
  reelmindTaskId: string | null
  apiTokenId: number | null
  accountId: number | null
  creditsUsed: number | null
  pollCount: number
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

export type TaskDetail = TaskSummary & {
  negativePrompt: string | null
  imageUrl: string | null
  aspectRatio: string | null
  duration: number | null
  resolution: string | null
  parameters: unknown
  resultData: unknown
}

export function parseTaskFilters(query: Query): TaskFilters {
  const filters: TaskFilters = {}

  const status = stringFilter(query.status)
  if (status) filters.status = status

  const type = stringFilter(query.type)
  if (type) filters.type = type

  const model = stringFilter(query.model)
  if (model) filters.model = model

  const accountId = positiveFilter(query.account_id)
  if (accountId !== null) filters.accountId = accountId

  const apiTokenId = positiveFilter(query.api_token_id)
  if (apiTokenId !== null) filters.apiTokenId = apiTokenId

  const createdFrom = timeFilter(query.created_from)
  if (createdFrom !== null) filters.createdFrom = createdFrom

  const createdTo = timeFilter(query.created_to)
  if (createdTo !== null) filters.createdTo = createdTo

  return filters
}

export function matchesTaskFilters(task: Task, filters: TaskFilters): boolean {
  if (filters.status && task.status !== filters.status) return false
  if (filters.type && task.type !== filters.type) return false
  if (filters.model && task.model !== filters.model) return false
  if (filters.accountId !== undefined && task.accountId !== filters.accountId) {
    return false
  }
  if (
    filters.apiTokenId !== undefined &&
    task.apiTokenId !== filters.apiTokenId
  ) {
    return false
  }
  if (filters.createdFrom !== undefined && task.createdAt < filters.createdFrom) {
    return false
  }
  if (filters.createdTo !== undefined && task.createdAt > filters.createdTo) {
    return false
  }

  return true
}

export function paginate<T>(items: T[], query: Query) {
  const page = positiveInt(query.page, 1)
  const limit = positiveInt(query.limit, 20, 100)
  const offset = (page - 1) * limit

  return {
    items: items.slice(offset, offset + limit),
    pagination: {
      page,
      limit,
      total: items.length,
    },
  }
}

export function summarizeTask(task: Task): TaskSummary {
  return {
    id: task.id,
    taskId: task.taskId,
    object: task.object,
    model: task.model,
    type: task.type,
    prompt: task.prompt ?? null,
    status: task.status,
    progress: task.progress ?? 0,
    resultUrl: task.resultUrl ?? null,
    errorMessage: task.errorMessage ?? null,
    reelmindTaskId: task.reelmindTaskId ?? null,
    apiTokenId: task.apiTokenId ?? null,
    accountId: task.accountId ?? null,
    creditsUsed: task.creditsUsed ?? null,
    pollCount: task.pollCount ?? 0,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt ?? null,
  }
}

export function detailTask(task: Task): TaskDetail {
  return {
    ...summarizeTask(task),
    negativePrompt: task.negativePrompt ?? null,
    imageUrl: task.imageUrl ?? null,
    aspectRatio: task.aspectRatio ?? null,
    duration: task.duration ?? null,
    resolution: task.resolution ?? null,
    parameters: parseJsonField(task.parameters),
    resultData: parseJsonField(task.resultData),
  }
}

function stringFilter(value: unknown): string | null {
  const raw = firstValue(value)
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed || null
}

function positiveFilter(value: unknown): number | null {
  const parsed = positiveInt(firstValue(value), 0)
  return parsed > 0 ? parsed : null
}

function timeFilter(value: unknown): number | null {
  const raw = firstValue(value)
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw !== 'string') return null

  const trimmed = raw.trim()
  if (!trimmed) return null

  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) return numeric

  const parsed = Date.parse(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function parseJsonField(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return value

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}
