import { randomUUID } from 'uncrypto'
import { authenticateApiKey, incrementUsage } from '../../../utils/api-auth'
import { getDb, schema } from '../../../db'
import { loadConfig } from '../../../utils/config'
import { refundReservedCredits, reserveAccountForCredits } from '../../../utils/account-pool'
import { IMAGE_GENERATION_COST } from '../../../utils/generation-costs'
import { buildImageGenerationPayload } from '../../../utils/generation-payload'
import { readUpstreamTaskId } from '../../../utils/upstream-task'

interface ImageGenerationRequest {
  model?: string
  prompt: string
  n?: number
  size?: string
  response_format?: string
  quality?: string
  style?: string
  user?: string
  negative_prompt?: string
  image?: string
}

export default defineEventHandler(async (event) => {
  const auth = await authenticateApiKey(event, IMAGE_GENERATION_COST)
  if (!auth) {
    setResponseStatus(event, 401)
    return { error: { message: 'Invalid API key', type: 'authentication_error', code: 401 } }
  }

  const body = await readBody(event) as ImageGenerationRequest
  if (!body.prompt) {
    setResponseStatus(event, 400)
    return { error: { message: 'prompt is required', type: 'invalid_request_error', code: 400 } }
  }

  const payload = buildImageGenerationPayload(body, 'text-to-image')
  const model = payload.model_id
  const taskId = `img-${randomUUID()}`
  const now = Date.now()

  const db = getDb()

  // Submit to ReelMind
  const config = loadConfig()
  const account = reserveAccountForCredits(IMAGE_GENERATION_COST)
  if (!account) {
    setResponseStatus(event, 503)
    return noAvailableAccountError()
  }
  const authToken = account.accessToken || ''

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
      refundReservedCredits(account.id, IMAGE_GENERATION_COST)
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
      object: 'image.generation',
      model,
      type: 'image',
      prompt: body.prompt,
      negativePrompt: payload.negative_prompt as string | undefined,
      imageUrl: referenceImageUrls?.[0],
      aspectRatio: payload.aspect_ratio as string | undefined,
      resolution: payload.resolution as string | undefined,
      parameters: JSON.stringify(payload),
      status: 'pending',
      reelmindTaskId: submission.taskId,
      apiTokenId: auth.tokenId,
      accountId: account?.id,
      createdAt: now,
      updatedAt: now,
    }).run()

    await incrementUsage(auth.tokenId, IMAGE_GENERATION_COST)

    return {
      id: taskId,
      object: 'image.generation',
      created: Math.floor(now / 1000),
      model,
      status: 'pending',
      data: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }
  } catch (err: any) {
    refundReservedCredits(account.id, IMAGE_GENERATION_COST)
    setResponseStatus(event, 500)
    return { error: { message: `Submission failed: ${err.message}`, type: 'api_error', code: 500 } }
  }
})

function noAvailableAccountError() {
  return {
    error: {
      message: 'No ReelMind account has enough credits for this request',
      type: 'api_error',
      code: 'no_available_account',
    },
  }
}
