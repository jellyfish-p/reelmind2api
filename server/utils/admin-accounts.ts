import type { Account, NewAccount, Task } from '../db/schema'
import { maskSecret, requiredString } from './admin-response'
import {
  decodeJwtExpirationMs,
  decodeJwtPayload,
  extractBearerToken,
  parseSupabaseCookieSession,
  SupabaseCookieSessionError,
  type ParsedSupabaseCookieSession,
} from './supabase-cookie-session'

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
  creditsRemaining: number | null
  taskCount: number
  createdAt: number
  updatedAt: number
  cookiePart0?: string | null
  cookiePart1?: string | null
  authorizationHeader?: string | null
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
  creditsRemaining: unknown
  cookieHeader: unknown
  cookiePart0: unknown
  cookiePart1: unknown
  authorizationHeader: unknown
}>

const ACCOUNT_FIELDS = new Set([
  'email',
  'name',
  'googleSub',
  'accessToken',
  'refreshToken',
  'tokenExpiresAt',
  'creditsRemaining',
  'cookieHeader',
  'cookiePart0',
  'cookiePart1',
  'authorizationHeader',
])

const DEFAULT_SUPABASE_AUTH_COOKIE = 'sb-ucljsqjaggrhupdayakz-auth-token'

export function sanitizeAccount(
  account: Account,
  tasks: Pick<Task, 'accountId'>[] = [],
  options: { includeTokenInputs?: boolean } = {},
): SanitizedAccount {
  const hasAccessToken = hasSecret(account.accessToken)
  const hasRefreshToken = hasSecret(account.refreshToken)
  const tokenExpiresAt = account.tokenExpiresAt ?? null

  const sanitized: SanitizedAccount = {
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
    creditsRemaining: account.creditsRemaining ?? null,
    taskCount: tasks.length,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }

  if (options.includeTokenInputs) {
    sanitized.cookiePart0 = (account as any).cookiePart0 ?? null
    sanitized.cookiePart1 = (account as any).cookiePart1 ?? null
    sanitized.authorizationHeader =
      (account as any).authorizationHeader ||
      bearerHeader(account.accessToken) ||
      null
  }

  return sanitized
}

export function accountValues(input: unknown, now = Date.now()): NewAccount {
  const body = validateAccountObject(input)
  const sessionValues = accountSessionValues(body)
  const email = requiredString(body.email) || requiredString(sessionValues.email)
  if (!email) throwInvalidField('email')

  const values: NewAccount = {
    email,
    createdAt: now,
    updatedAt: now,
  }

  applyDerivedSessionValues(values, sessionValues)
  applyOptionalCreateValues(values, body)
  return values
}

export function accountPatchValues(
  input: unknown,
  now = Date.now(),
): Partial<NewAccount> {
  const body = validateAccountObject(input)
  const sessionValues = accountSessionValues(body)
  const values: Partial<NewAccount> = {}

  for (const key of Object.keys(body)) {
    if (!ACCOUNT_FIELDS.has(key)) {
      throw new AccountInputError(`Unsupported account field: ${key}`)
    }
  }

  applyDerivedSessionValues(values, sessionValues)

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
  if (Object.prototype.hasOwnProperty.call(body, 'creditsRemaining')) {
    values.creditsRemaining = normalizeNullableNumber(
      body.creditsRemaining,
      'creditsRemaining',
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

export function isUniqueAccountConstraintError(error: unknown): boolean {
  const err = error as any
  const message = String(err?.message || '')
  return err?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    (err?.code === 'SQLITE_CONSTRAINT' && message.includes('UNIQUE')) ||
    message.includes('UNIQUE constraint failed')
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
  if (Object.prototype.hasOwnProperty.call(body, 'creditsRemaining')) {
    values.creditsRemaining = normalizeNullableNumber(
      body.creditsRemaining,
      'creditsRemaining',
    )
  }
}

function accountSessionValues(body: AccountInput): Partial<NewAccount> {
  const values: Partial<NewAccount> = {}

  if (Object.prototype.hasOwnProperty.call(body, 'cookieHeader')) {
    const cookieHeader = normalizeOptionalInput(body.cookieHeader, 'cookieHeader')
    if (cookieHeader) {
      applySupabaseSession(values, safeParseSupabaseCookie(cookieHeader))
      applyCookiePartsFromHeader(values, cookieHeader)
    }
  }

  applySplitCookieInput(values, body)

  if (Object.prototype.hasOwnProperty.call(body, 'authorizationHeader')) {
    const authorizationHeader = normalizeOptionalInput(
      body.authorizationHeader,
      'authorizationHeader',
    )
    if (authorizationHeader) {
      const token = extractBearerToken(authorizationHeader)
      if (!token) throwInvalidField('authorizationHeader')
      values.accessToken = token
      values.authorizationHeader = bearerHeader(token)
      const expiresAt = decodeJwtExpirationMs(token)
      if (expiresAt !== null) values.tokenExpiresAt = expiresAt

      const payload = decodeJwtPayload(token)
      if (!values.email && payload?.email) values.email = String(payload.email)
    }
  }

  return values
}

function safeParseSupabaseCookie(cookieHeader: string): ParsedSupabaseCookieSession {
  try {
    return parseSupabaseCookieSession(cookieHeader)
  } catch (error) {
    if (error instanceof SupabaseCookieSessionError) {
      throw new AccountInputError(error.message)
    }
    throw error
  }
}

function applySupabaseSession(
  values: Partial<NewAccount>,
  session: ParsedSupabaseCookieSession,
) {
  values.accessToken = session.accessToken
  values.authorizationHeader = bearerHeader(session.accessToken)
  if (session.refreshToken !== null) values.refreshToken = session.refreshToken
  if (session.tokenExpiresAt !== null) values.tokenExpiresAt = session.tokenExpiresAt
  if (session.email !== null) values.email = session.email
  if (session.name !== null) values.name = session.name
  if (session.googleSub !== null) values.googleSub = session.googleSub
}

function applyDerivedSessionValues(
  values: Partial<NewAccount>,
  sessionValues: Partial<NewAccount>,
) {
  if (sessionValues.name !== undefined) values.name = sessionValues.name
  if (sessionValues.googleSub !== undefined) values.googleSub = sessionValues.googleSub
  if (sessionValues.accessToken !== undefined) {
    values.accessToken = sessionValues.accessToken
  }
  if (sessionValues.refreshToken !== undefined) {
    values.refreshToken = sessionValues.refreshToken
  }
  if (sessionValues.tokenExpiresAt !== undefined) {
    values.tokenExpiresAt = sessionValues.tokenExpiresAt
  }
  if ((sessionValues as any).cookiePart0 !== undefined) {
    ;(values as any).cookiePart0 = (sessionValues as any).cookiePart0
  }
  if ((sessionValues as any).cookiePart1 !== undefined) {
    ;(values as any).cookiePart1 = (sessionValues as any).cookiePart1
  }
  if ((sessionValues as any).authorizationHeader !== undefined) {
    ;(values as any).authorizationHeader = (sessionValues as any).authorizationHeader
  }
}

function applySplitCookieInput(values: Partial<NewAccount>, body: AccountInput) {
  const hasPart0 = Object.prototype.hasOwnProperty.call(body, 'cookiePart0')
  const hasPart1 = Object.prototype.hasOwnProperty.call(body, 'cookiePart1')
  if (!hasPart0 && !hasPart1) return

  const cookiePart0 = normalizeOptionalInput(body.cookiePart0, 'cookiePart0')
  const cookiePart1 = normalizeOptionalInput(body.cookiePart1, 'cookiePart1')
  if (!cookiePart0 && !cookiePart1) return
  if (!cookiePart0 || !cookiePart1) {
    throw new AccountInputError('Both cookiePart0 and cookiePart1 are required')
  }

  ;(values as any).cookiePart0 = cookiePart0
  ;(values as any).cookiePart1 = cookiePart1
  applySupabaseSession(
    values,
    safeParseSupabaseCookie(cookieHeaderFromParts(cookiePart0, cookiePart1)),
  )
}

function applyCookiePartsFromHeader(values: Partial<NewAccount>, cookieHeader: string) {
  const normalized = cookieHeader.trim().replace(/^Cookie:\s*/i, '')
  for (const part of normalized.split(/;\s*/)) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (name.endsWith('-auth-token.0')) {
      ;(values as any).cookiePart0 = value
    } else if (name.endsWith('-auth-token.1')) {
      ;(values as any).cookiePart1 = value
    }
  }
}

function cookieHeaderFromParts(part0: string, part1: string): string {
  return [
    cookieAssignment(part0, `${DEFAULT_SUPABASE_AUTH_COOKIE}.0`),
    cookieAssignment(part1, `${DEFAULT_SUPABASE_AUTH_COOKIE}.1`),
  ].join('; ')
}

function cookieAssignment(input: string, fallbackName: string): string {
  const normalized = input.trim().replace(/^Cookie:\s*/i, '')
  return normalized.includes('=') ? normalized : `${fallbackName}=${normalized}`
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

function normalizeNullableNumber(value: unknown, field: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throwInvalidField(field)
  }
  return value
}

function normalizeOptionalInput(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throwInvalidField(field)
  const normalized = value.trim()
  return normalized || null
}

function bearerHeader(token: unknown): string | null {
  if (typeof token !== 'string' || !token.trim()) return null
  return `Bearer ${token.trim()}`
}

function hasSecret(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0
}

function throwInvalidField(field: string): never {
  throw new AccountInputError(`Invalid account field: ${field}`)
}
