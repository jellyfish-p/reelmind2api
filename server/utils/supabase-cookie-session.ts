export interface ParsedSupabaseCookieSession {
  cookieName: string
  accessToken: string
  refreshToken: string | null
  tokenExpiresAt: number | null
  email: string | null
  name: string | null
  googleSub: string | null
}

export class SupabaseCookieSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupabaseCookieSessionError'
  }
}

type CookiePair = [string, string]

export function parseSupabaseCookieSession(
  cookieHeader: unknown,
): ParsedSupabaseCookieSession {
  const cookieText = optionalString(cookieHeader)
  if (!cookieText) {
    throw new SupabaseCookieSessionError('Invalid account field: cookieHeader')
  }

  const pairs = parseCookiePairs(cookieText)
  const candidates = supabaseSessionCookieCandidates(pairs)
  let lastError: unknown

  for (const candidate of candidates) {
    try {
      const session = decodeSessionValue(candidate.value)
      return normalizeSession(candidate.cookieName, session)
    } catch (error) {
      lastError = error
    }
  }

  if (lastError instanceof SupabaseCookieSessionError) {
    throw lastError
  }
  throw new SupabaseCookieSessionError(
    'No Supabase auth session cookie found in cookieHeader',
  )
}

export function extractBearerToken(value: unknown): string | null {
  const raw = optionalString(value)
  if (!raw) return null
  const match = raw.match(/^Bearer\s+(.+)$/i)
  const token = (match ? match[1] : raw).trim()
  return token || null
}

export function decodeJwtPayload(token: string): Record<string, any> | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    return JSON.parse(base64UrlDecode(parts[1]))
  } catch {
    return null
  }
}

export function decodeJwtExpirationMs(token: string): number | null {
  const payload = decodeJwtPayload(token)
  const exp = numericValue(payload?.exp)
  return exp === null ? null : exp * 1000
}

function parseCookiePairs(cookieHeader: string): CookiePair[] {
  const normalized = cookieHeader.trim().replace(/^Cookie:\s*/i, '')
  const pairs: CookiePair[] = []

  for (const part of normalized.split(/;\s*/)) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue

    const name = trimmed.slice(0, separator).trim()
    const value = safeDecodeURIComponent(trimmed.slice(separator + 1).trim())
    if (name) pairs.push([name, value])
  }

  return pairs
}

function supabaseSessionCookieCandidates(pairs: CookiePair[]) {
  const chunkGroups = new Map<string, Array<{ index: number; value: string }>>()
  const candidates: Array<{ cookieName: string; value: string }> = []

  for (const [name, value] of pairs) {
    const chunkMatch = name.match(/^(sb-[A-Za-z0-9_-]+-auth-token)\.(\d+)$/)
    if (chunkMatch) {
      const [, cookieName, indexText] = chunkMatch
      const chunks = chunkGroups.get(cookieName) || []
      chunks.push({ index: Number(indexText), value })
      chunkGroups.set(cookieName, chunks)
      continue
    }

    if (/^sb-[A-Za-z0-9_-]+-auth-token$/.test(name)) {
      candidates.push({ cookieName: name, value })
    }
  }

  for (const [cookieName, chunks] of chunkGroups.entries()) {
    const value = chunks
      .sort((a, b) => a.index - b.index)
      .map((chunk) => chunk.value)
      .join('')
    candidates.push({ cookieName, value })
  }

  return candidates
}

function decodeSessionValue(value: string): unknown {
  const raw = value.startsWith('base64-') ? value.slice('base64-'.length) : value
  const decoded = raw.startsWith('{') || raw.startsWith('[')
    ? raw
    : base64UrlDecode(raw)

  try {
    return JSON.parse(decoded)
  } catch {
    throw new SupabaseCookieSessionError(
      'Invalid Supabase auth session cookie payload',
    )
  }
}

function normalizeSession(
  cookieName: string,
  session: unknown,
): ParsedSupabaseCookieSession {
  if (!isObject(session)) {
    throw new SupabaseCookieSessionError(
      'Invalid Supabase auth session cookie payload',
    )
  }

  const accessToken = optionalString(session.access_token)
  if (!accessToken) {
    throw new SupabaseCookieSessionError(
      'Supabase auth session cookie is missing access_token',
    )
  }

  const user = isObject(session.user) ? session.user : {}
  const metadata = isObject(user.user_metadata) ? user.user_metadata : {}
  const refreshToken = optionalString(session.refresh_token)
  const expiresAt = numericValue(session.expires_at)

  return {
    cookieName,
    accessToken,
    refreshToken,
    tokenExpiresAt: expiresAt !== null
      ? expiresAt * 1000
      : decodeJwtExpirationMs(accessToken),
    email: optionalString(user.email) || optionalString(metadata.email),
    name:
      optionalString(metadata.full_name) ||
      optionalString(metadata.name) ||
      optionalString(user.name),
    googleSub:
      optionalString(metadata.provider_id) ||
      optionalString(metadata.sub) ||
      googleIdentityId(user),
  }
}

function googleIdentityId(user: Record<string, any>): string | null {
  const identities = Array.isArray(user.identities) ? user.identities : []
  const googleIdentity = identities.find(
    (identity) => isObject(identity) && identity.provider === 'google',
  )
  return isObject(googleIdentity)
    ? optionalString(googleIdentity.id) || optionalString(googleIdentity.user_id)
    : null
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  )
  return Buffer.from(padded, 'base64').toString('utf8')
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
