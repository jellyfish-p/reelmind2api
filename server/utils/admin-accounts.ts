import type { Account, NewAccount, Task } from '../db/schema'
import { maskSecret, requiredString } from './admin-response'

export type SanitizedAccount = {
  id: number
  email: string
  name: string | null
  googleSub: string | null
  hasAccessToken: boolean
  accessTokenPreview: string | null
  hasRefreshToken: boolean
  refreshTokenPreview: string | null
  tokenExpiresAt: number | null
  tokenExpired: boolean
  taskCount: number
  createdAt: number
  updatedAt: number
}

export class AccountInputError extends Error {
  code: string
  status: number

  constructor(message: string, code = 'invalid_account', status = 400) {
    super(message)
    this.name = 'AccountInputError'
    this.code = code
    this.status = status
  }
}

type AccountInput = Partial<{
  email: unknown
  name: unknown
  googleSub: unknown
  accessToken: unknown
  refreshToken: unknown
  tokenExpiresAt: unknown
}>

const ACCOUNT_FIELDS = new Set([
  'email',
  'name',
  'googleSub',
  'accessToken',
  'refreshToken',
  'tokenExpiresAt',
])

export function sanitizeAccount(
  account: Account,
  tasks: Pick<Task, 'accountId'>[] = [],
): SanitizedAccount {
  const hasAccessToken = hasSecret(account.accessToken)
  const hasRefreshToken = hasSecret(account.refreshToken)
  const tokenExpiresAt = account.tokenExpiresAt ?? null

  return {
    id: account.id,
    email: account.email,
    name: account.name ?? null,
    googleSub: account.googleSub ?? null,
    hasAccessToken,
    accessTokenPreview: hasAccessToken ? maskSecret(account.accessToken) : null,
    hasRefreshToken,
    refreshTokenPreview: hasRefreshToken ? maskSecret(account.refreshToken) : null,
    tokenExpiresAt,
    tokenExpired: typeof tokenExpiresAt === 'number' && tokenExpiresAt < Date.now(),
    taskCount: tasks.length,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }
}

export function accountValues(input: unknown, now = Date.now()): NewAccount {
  const body = validateAccountObject(input)
  const email = requiredString(body.email)
  if (!email) throwInvalidField('email')

  const values: NewAccount = {
    email,
    createdAt: now,
    updatedAt: now,
  }

  applyOptionalCreateValues(values, body)
  return values
}

export function accountPatchValues(
  input: unknown,
  now = Date.now(),
): Partial<NewAccount> {
  const body = validateAccountObject(input)
  const values: Partial<NewAccount> = {}

  for (const key of Object.keys(body)) {
    if (!ACCOUNT_FIELDS.has(key)) {
      throw new AccountInputError(`Unsupported account field: ${key}`)
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'email')) {
    const email = requiredString(body.email)
    if (!email) throwInvalidField('email')
    values.email = email
  }
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    values.name = normalizeNullableString(body.name, 'name')
  }
  if (Object.prototype.hasOwnProperty.call(body, 'googleSub')) {
    values.googleSub = normalizeNullableString(body.googleSub, 'googleSub')
  }
  if (Object.prototype.hasOwnProperty.call(body, 'accessToken')) {
    values.accessToken = normalizeNullableString(body.accessToken, 'accessToken')
  }
  if (Object.prototype.hasOwnProperty.call(body, 'refreshToken')) {
    values.refreshToken = normalizeNullableString(body.refreshToken, 'refreshToken')
  }
  if (Object.prototype.hasOwnProperty.call(body, 'tokenExpiresAt')) {
    values.tokenExpiresAt = normalizeNullableInteger(
      body.tokenExpiresAt,
      'tokenExpiresAt',
    )
  }

  if (Object.keys(values).length === 0) {
    throw new AccountInputError('Invalid account payload')
  }

  values.updatedAt = now
  return values
}

export function isAccountInputError(error: unknown): error is AccountInputError {
  return error instanceof AccountInputError
}

export function parseAccountId(value: unknown): number | null {
  if (Array.isArray(value)) return parseAccountId(value[0])
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) return null
  return id
}

function applyOptionalCreateValues(values: NewAccount, body: AccountInput) {
  for (const key of Object.keys(body)) {
    if (!ACCOUNT_FIELDS.has(key)) {
      throw new AccountInputError(`Unsupported account field: ${key}`)
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    values.name = normalizeNullableString(body.name, 'name')
  }
  if (Object.prototype.hasOwnProperty.call(body, 'googleSub')) {
    values.googleSub = normalizeNullableString(body.googleSub, 'googleSub')
  }
  if (Object.prototype.hasOwnProperty.call(body, 'accessToken')) {
    values.accessToken = normalizeNullableString(body.accessToken, 'accessToken')
  }
  if (Object.prototype.hasOwnProperty.call(body, 'refreshToken')) {
    values.refreshToken = normalizeNullableString(body.refreshToken, 'refreshToken')
  }
  if (Object.prototype.hasOwnProperty.call(body, 'tokenExpiresAt')) {
    values.tokenExpiresAt = normalizeNullableInteger(
      body.tokenExpiresAt,
      'tokenExpiresAt',
    )
  }
}

function validateAccountObject(input: unknown): AccountInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new AccountInputError('Invalid account payload')
  }
  return input as AccountInput
}

function normalizeNullableString(value: unknown, field: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throwInvalidField(field)
  const normalized = value.trim()
  return normalized || null
}

function normalizeNullableInteger(value: unknown, field: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throwInvalidField(field)
  }
  return value
}

function hasSecret(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0
}

function throwInvalidField(field: string): never {
  throw new AccountInputError(`Invalid account field: ${field}`)
}
