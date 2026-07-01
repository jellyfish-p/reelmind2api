import { describe, expect, it } from 'vitest'
import {
  extractBearerToken,
  parseSupabaseCookieSession,
} from '../server/utils/supabase-cookie-session'

function encodeSession(session: Record<string, unknown>): string {
  return `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`
}

describe('Supabase cookie session parsing', () => {
  it('decodes split Supabase auth token cookies into token credentials', () => {
    const encoded = encodeSession({
      access_token: 'access.jwt.token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: 1782896787,
      refresh_token: 'refresh-secret',
      user: {
        id: 'user-uuid',
        email: 'cookie@example.test',
        user_metadata: {
          full_name: 'Cookie User',
          provider_id: 'google-sub',
        },
      },
    })
    const cookieHeader = [
      'rm_anonymous_id=anon',
      `sb-ucljsqjaggrhupdayakz-auth-token.0=${encoded.slice(0, 40)}`,
      `sb-ucljsqjaggrhupdayakz-auth-token.1=${encoded.slice(40)}`,
      'sb-ucljsqjaggrhupdayakz-auth-token-code-verifier=ignored',
    ].join('; ')

    const parsed = parseSupabaseCookieSession(cookieHeader)

    expect(parsed).toMatchObject({
      cookieName: 'sb-ucljsqjaggrhupdayakz-auth-token',
      accessToken: 'access.jwt.token',
      refreshToken: 'refresh-secret',
      tokenExpiresAt: 1782896787000,
      email: 'cookie@example.test',
      name: 'Cookie User',
      googleSub: 'google-sub',
    })
  })

  it('extracts bearer tokens from authorization header text', () => {
    expect(extractBearerToken('Bearer access.jwt.token')).toBe('access.jwt.token')
    expect(extractBearerToken(' access.jwt.token ')).toBe('access.jwt.token')
    expect(extractBearerToken('')).toBeNull()
  })
})
