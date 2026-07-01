import { authenticateAdmin } from './api-auth'

export interface AdminError {
  error: {
    message: string
    code: string
  }
}

export async function requireAdmin(event: any): Promise<AdminError | null> {
  if (await authenticateAdmin(event)) return null
  setResponseStatus(event, 401)
  return adminErrorBody('Invalid admin key', 'invalid_admin_key')
}

export function adminError(
  event: any,
  status: number,
  message: string,
  code: string,
): AdminError {
  setResponseStatus(event, status)
  return adminErrorBody(message, code)
}

function adminErrorBody(message: string, code: string): AdminError {
  return { error: { message, code } }
}

export function maskSecret(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  if (value.length <= 4) return '***'
  if (value.length <= 8) return `${value.slice(0, 2)}***${value.slice(-2)}`
  return `${value.slice(0, 4)}***${value.slice(-4)}`
}

export function positiveInt(value: unknown, fallback: number, max?: number): number {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  const integer = Math.floor(parsed)
  return max === undefined ? integer : Math.min(integer, max)
}

export function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
