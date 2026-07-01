import type { AuthSession } from '../../types/reelmind'

function getGoogleClientId(): string {
  const config = useRuntimeConfig()
  return (config.googleClientId as string) || ''
}

export interface GoogleTokenInfo {
  iss: string
  azp: string
  aud: string
  sub: string
  email: string
  email_verified: boolean
  name?: string
  picture?: string
  given_name?: string
  family_name?: string
  iat: number
  exp: number
}

export async function verifyGoogleIdToken(token: string): Promise<GoogleTokenInfo | null> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`)
    if (!res.ok) {
      return null
    }
    const info: GoogleTokenInfo = await res.json()
    if (getGoogleClientId() && info.aud !== getGoogleClientId()) {
      return null
    }
    return info
  } catch {
    return null
  }
}

export function createSessionFromGoogleToken(tokenInfo: GoogleTokenInfo, accessToken: string, expiresAt: number): AuthSession {
  return {
    accessToken,
    expiresAt,
    tokenType: 'Bearer',
    user: {
      id: tokenInfo.sub,
      email: tokenInfo.email,
      name: tokenInfo.name || tokenInfo.given_name,
    },
  }
}

// TOTP / verification parameter calculation placeholder
// ReelMind may use additional verification headers or signed parameters.
// The observed headers from the browser include:
// - sec-ch-ua
// - sec-ch-ua-mobile
// - sec-ch-ua-platform
// These are Client Hints sent by Chromium-based browsers and are NOT
// used for API authentication. They are for browser fingerprinting and
// adaptive content delivery. The actual auth layer uses Google Identity
// (FedCM / OAuth2) via accounts.google.com/gsi/client.
//
// For the server-side API proxy, auth verification involves:
// 1. Receiving Google ID token from client (obtained via Google Sign-In)
// 2. Verifying it with Google’s tokeninfo endpoint
// 3. Passing Bearer token to nestapi.reelmind.ai
//
// Additional verification parameters that may be required:
// - X-API-Key header (set via NUXT_REELMIND_API_KEY env var)
// - Device / session fingerprint
export function generateSessionFingerprint(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${timestamp}-${random}`
}
