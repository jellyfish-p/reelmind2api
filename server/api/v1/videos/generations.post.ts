import { randomUUID } from 'uncrypto'
import { authenticateApiKey, incrementUsage } from '../../../utils/api-auth'
import { getDb, schema } from '../../../db'
import { loadConfig } from '../../../utils/config'
import { buildVideoGenerationPayload } from '../../../utils/generation-payload'
import { readUpstreamTaskId } from '../../../utils/upstream-task'
import { eq } from 'drizzle-orm'

interface VideoGenerationRequest {
  model?: string
  prompt: string
  n?: number
  size?: string
  duration?: number
  response_format?: string
  user?: string
  negative_prompt?: string
  image?: string
  fps?: number
  aspect_ratio?: string
  resolution?: string
  gen_type?: string
  movement_amplitude?: string
  bgm?: boolean
  generate_audio?: boolean
  generation_mode?: string
}

const VIDEO_GENERATION_COST = 3

export default defineEventHandler(async (event) => {
  const auth = await authenticateApiKey(event, VIDEO_GENERATION_COST)
  if (!auth) {
    setResponseStatus(event, 401)
    return { error: { message: 'Invalid API key', type: 'authentication_error', code: 401 } }
  }

  const body = await readBody(event) as VideoGenerationRequest
  if (!body.prompt) {
    setResponseStatus(event, 400)
    return { error: { message: 'prompt is required', type: 'invalid_request_error', code: 400 } }
  }

  const payload = buildVideoGenerationPayload(body)
  const model = payload.model_id
  const taskId = `vid-${randomUUID()}`
  const now = Date.now()

  const db = getDb()
  const config = loadConfig()
  const account = db.select().from(schema.accounts).where(eq(schema.accounts.id, 1)).get()
  const authToken = account?.accessToken || ''

  try {
    const reelmindRes = await fetch(`${config.reelmind.api_base}/generation/gen-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authToken ? `Bearer ${authToken}` : '',
        'Referer': config.reelmind.web_base,
      },
      body: JSON.stringify(payload),
    })

    const submission = await readUpstreamTaskId(reelmindRes)
    if (!submission.taskId) {
      setResponseStatus(event, 502)
      return {
        error: {
          message: `ReelMind submission failed: ${submission.error}`,
          type: 'api_error',
          code: 502,
        },
      }
    }

    const referenceImageUrls = payload.reference_image_urls as string[] | undefined

    db.insert(schema.tasks).values({
      taskId,
      object: 'video.generation',
      model,
      type: 'video',
      prompt: body.prompt,
      negativePrompt: payload.negative_prompt as string | undefined,
      imageUrl: referenceImageUrls?.[0],
      aspectRatio: payload.aspect_ratio as string | undefined,
      duration: payload.duration as number | undefined,
      resolution: payload.resolution as string | undefined,
      parameters: JSON.stringify(payload),
      status: 'pending',
      reelmindTaskId: submission.taskId,
      apiTokenId: auth.tokenId,
      accountId: account?.id,
      createdAt: now,
      updatedAt: now,
    }).run()

    await incrementUsage(auth.tokenId, VIDEO_GENERATION_COST)

    return {
      id: taskId,
      object: 'video.generation',
      created: Math.floor(now / 1000),
      model,
      status: 'pending',
      data: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }
  } catch (err: any) {
    setResponseStatus(event, 500)
    return { error: { message: `Submission failed: ${err.message}`, type: 'api_error', code: 500 } }
  }
})
