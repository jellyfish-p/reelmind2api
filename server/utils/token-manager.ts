import { getDb, schema } from '../db'
import { eq, and, lt, sql } from 'drizzle-orm'
import { loadConfig } from './config'
import { extractCreditsUsed, extractResultUrl, extractTaskStatus } from './upstream-task'
import { decodeJwtPayload } from './supabase-cookie-session'

const DEFAULT_SUPABASE_PUBLIC_KEY = 'sb_publishable_Oeql6-nxTd5RIa1tjlCMKw_O1v3aZD2'

let pollingInterval: ReturnType<typeof setInterval> | null = null

export async function startTokenPolling() {
  if (pollingInterval) return
  const config = loadConfig()
  const interval = config.polling?.interval || 5000
  pollingInterval = setInterval(pollTaskStatus, interval)
  await pollTaskStatus()
}

export function stopTokenPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
  }
}

async function pollTaskStatus() {
  const db = getDb()
  const config = loadConfig()
  const maxRetries = config.polling?.max_retries || 120
  const now = Date.now()

  // Find pending/processing tasks that need polling
  const activeTasks = db
    .select()
    .from(schema.tasks)
    .where(
      and(
        sql`${schema.tasks.status} IN ('pending', 'processing', 'submitted')`,
        sql`${schema.tasks.pollCount} < ${maxRetries}`,
        sql`${schema.tasks.reelmindTaskId} IS NOT NULL`,
        sql`${schema.tasks.reelmindTaskId} != ''`,
      ),
    )
    .all()

  for (const task of activeTasks) {
    await pollSingleTask(task, db, maxRetries, now)
  }

  await refreshExpiringTokens(db, config)
}

async function pollSingleTask(task: any, db: any, maxRetries: number, now: number) {
  if (task.pollCount >= maxRetries) {
    db.update(schema.tasks)
      .set({
        status: 'failed',
        errorMessage: 'Polling max retries exceeded',
        updatedAt: now,
      })
      .where(eq(schema.tasks.id, task.id))
      .run()
    return
  }

  // Attempt to query task status from ReelMind API
  try {
    const account = task.accountId
      ? db.select().from(schema.accounts).where(eq(schema.accounts.id, task.accountId)).get()
      : null
    const authToken = account?.accessToken || ''

    const statusRes = await fetch(
      `${(loadConfig()).reelmind.api_base}/generation/task/${task.reelmindTaskId}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authToken ? `Bearer ${authToken}` : '',
          'Referer': (loadConfig()).reelmind.web_base,
        },
      },
    )

    db.update(schema.tasks)
      .set({ pollCount: sql`poll_count + 1`, updatedAt: now })
      .where(eq(schema.tasks.id, task.id))
      .run()

    if (!statusRes.ok) {
      if (task.pollCount > 10) {
        db.update(schema.tasks)
          .set({
            status: 'failed',
            errorMessage: `Status check failed: HTTP ${statusRes.status}`,
            updatedAt: now,
          })
          .where(eq(schema.tasks.id, task.id))
          .run()
      }
      return
    }

    const statusData: any = await statusRes.json()
    const mappedStatus = mapReelmindStatus(statusData)

    const updateData: any = { status: mappedStatus, updatedAt: now }

    if (mappedStatus === 'completed' || mappedStatus === 'succeeded') {
      updateData.resultUrl = extractResultUrl(statusData)
      updateData.resultData = JSON.stringify(statusData)
      updateData.completedAt = now
      updateData.progress = 100
      updateData.creditsUsed = extractCreditsUsed(statusData)
    } else if (mappedStatus === 'failed') {
      updateData.errorMessage = statusData.error || statusData.message || 'Task failed'
      updateData.completedAt = now
    } else if (mappedStatus === 'processing') {
      updateData.progress = statusData.progress || Math.min(task.progress + 10, 90)
    }

    db.update(schema.tasks)
      .set(updateData)
      .where(eq(schema.tasks.id, task.id))
      .run()
  } catch (err: any) {
    db.update(schema.tasks)
      .set({ pollCount: sql`poll_count + 1`, updatedAt: now })
      .where(eq(schema.tasks.id, task.id))
      .run()
    if (task.pollCount > 20) {
      db.update(schema.tasks)
        .set({ status: 'failed', errorMessage: `Poll error: ${err.message}`, updatedAt: now })
        .where(eq(schema.tasks.id, task.id))
        .run()
    }
  }
}

function mapReelmindStatus(data: any): string {
  const s = extractTaskStatus(data)?.toLowerCase() || ''
  if (s === 'completed' || s === 'done' || s === 'success') return 'completed'
  if (s === 'failed' || s === 'error') return 'failed'
  if (s === 'processing' || s === 'running' || s === 'in_progress') return 'processing'
  if (s === 'pending' || s === 'queued' || s === 'submitted') return 'pending'
  return 'pending'
}

async function refreshExpiringTokens(db: any, config: any) {
  const margin = config.polling?.token_refresh_margin || 300
  const now = Date.now()
  const expiryThreshold = now + margin * 1000

  const expiringAccounts = db
    .select()
    .from(schema.accounts)
    .where(
      and(
        sql`${schema.accounts.refreshToken} IS NOT NULL`,
        sql`${schema.accounts.tokenExpiresAt} IS NOT NULL`,
        lt(schema.accounts.tokenExpiresAt, expiryThreshold),
      ),
    )
    .all()

  for (const account of expiringAccounts) {
    try {
      if (await refreshSupabaseAccountToken(db, account, config, now)) continue
      await refreshGoogleAccountToken(db, account, config, now)
    } catch {
      // silent fail, will retry next cycle
    }
  }
}

async function refreshSupabaseAccountToken(
  db: any,
  account: any,
  config: any,
  now: number,
): Promise<boolean> {
  const authBase = supabaseAuthBaseFromAccessToken(account.accessToken)
  if (!authBase) return false

  const publicKey =
    config.reelmind?.supabase_anon_key ||
    config.reelmind?.supabase_public_key ||
    DEFAULT_SUPABASE_PUBLIC_KEY
  const refreshRes = await fetch(`${authBase}/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: publicKey,
      Authorization: `Bearer ${publicKey}`,
    },
    body: JSON.stringify({ refresh_token: account.refreshToken! }),
  })

  if (!refreshRes.ok) return true

  const data: any = await refreshRes.json()
  const expiresAt = resolveTokenExpiry(data, now)
  db.update(schema.accounts)
    .set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || account.refreshToken,
      tokenExpiresAt: expiresAt,
      updatedAt: now,
    })
    .where(eq(schema.accounts.id, account.id))
    .run()
  return true
}

async function refreshGoogleAccountToken(
  db: any,
  account: any,
  config: any,
  now: number,
) {
  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.reelmind?.google_client_id || '',
      refresh_token: account.refreshToken!,
      grant_type: 'refresh_token',
    }),
  })
  if (refreshRes.ok) {
    const data: any = await refreshRes.json()
    db.update(schema.accounts)
      .set({
        accessToken: data.access_token,
        refreshToken: data.refresh_token || account.refreshToken,
        tokenExpiresAt: resolveTokenExpiry(data, now),
        updatedAt: now,
      })
      .where(eq(schema.accounts.id, account.id))
      .run()
  }
}

function supabaseAuthBaseFromAccessToken(accessToken: unknown): string | null {
  if (typeof accessToken !== 'string' || !accessToken.trim()) return null
  const payload = decodeJwtPayload(accessToken)
  const issuer = typeof payload?.iss === 'string' ? payload.iss : ''
  return issuer.endsWith('/auth/v1') ? issuer : null
}

function resolveTokenExpiry(data: any, now: number): number {
  const expiresAt = Number(data?.expires_at)
  if (Number.isFinite(expiresAt) && expiresAt > 0) return expiresAt * 1000
  const expiresIn = Number(data?.expires_in)
  return now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000
}

