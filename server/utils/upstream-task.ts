function scalarString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function firstUrl(value: unknown): string | undefined {
  const scalar = scalarString(value)
  if (scalar) return scalar

  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstUrl(item)
      if (url) return url
    }
    return undefined
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return (
      firstUrl(record.url) ||
      firstUrl(record.result_url) ||
      firstUrl(record.resultUrl) ||
      firstUrl(record.video_url) ||
      firstUrl(record.image_url)
    )
  }

  return undefined
}

export function extractUpstreamTaskId(data: any): string {
  return (
    scalarString(data?.task_id) ||
    scalarString(data?.taskId) ||
    scalarString(data?.id) ||
    scalarString(data?.data?.task_id) ||
    scalarString(data?.data?.taskId) ||
    scalarString(data?.data?.id) ||
    scalarString(data?.task?.id) ||
    ''
  )
}

export function extractResultUrl(data: any): string | undefined {
  return (
    firstUrl(data?.result_url) ||
    firstUrl(data?.resultUrl) ||
    firstUrl(data?.output?.video_url) ||
    firstUrl(data?.output?.image_url) ||
    firstUrl(data?.output?.url) ||
    firstUrl(data?.output_result) ||
    firstUrl(data?.data?.result_url) ||
    firstUrl(data?.data?.resultUrl) ||
    firstUrl(data?.data?.output?.video_url) ||
    firstUrl(data?.data?.output?.image_url) ||
    firstUrl(data?.data?.output_result)
  )
}

export function extractTaskStatus(data: any): string | undefined {
  return (
    scalarString(data?.status) ||
    scalarString(data?.data?.status) ||
    scalarString(data?.task?.status)
  )
}

export function extractCreditsUsed(data: any): number | undefined {
  const value = data?.credits_used ??
    data?.creditsUsed ??
    data?.cost ??
    data?.usage?.credits ??
    data?.data?.credits_used ??
    data?.data?.creditsUsed ??
    data?.data?.cost ??
    data?.data?.usage?.credits
  const credits = Number(value)
  return Number.isFinite(credits) ? credits : undefined
}

export async function readUpstreamTaskId(res: Response): Promise<{
  taskId: string
  error?: string
}> {
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return {
      taskId: '',
      error: `HTTP ${res.status}: ${res.statusText}${body ? `. ${body}` : ''}`,
    }
  }

  const data = await res.json().catch(() => null)
  const taskId = extractUpstreamTaskId(data)
  if (!taskId) {
    return {
      taskId: '',
      error: 'Missing task id in ReelMind response',
    }
  }

  return { taskId }
}
