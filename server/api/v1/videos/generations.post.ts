import { randomUUID } from 'uncrypto'
import { authenticateApiKey, incrementUsage } from '../../../utils/api-auth'
import { getDb, schema } from '../../../db'
import { loadConfig } from '../../../utils/config'
import { refundReservedCredits, reserveAccountForCredits } from '../../../utils/account-pool'
import { videoGenerationCost } from '../../../utils/generation-costs'
import { buildVideoGenerationPayload, unsupportedAudioUrl } from '../../../utils/generation-payload'
import { readUpstreamTaskId } from '../../../utils/upstream-task'

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
  image_url?: string
  imageUrl?: string
  reference_image_urls?: string[]
  referenceImageUrls?: string[]
  video?: string
  video_url?: string
  videoUrl?: string
  video_urls?: string[]
  videoUrls?: string[]
  audio?: string
  audio_url?: string
  audioUrl?: string
  audio_urls?: string[]
  audioUrls?: string[]
  fps?: number
  ratio?: string
  aspect_ratio?: string
  resolution?: string
  gen_type?: string
  genType?: string
  movement_amplitude?: string
  bgm?: boolean
  generate_audio?: boolean
  generateAudio?: boolean
  generation_mode?: string
  generationMode?: string
  watermark?: boolean
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as VideoGenerationRequest
  const payload = buildVideoGenerationPayload(body)
  const generationCost = videoGenerationCost(payload.duration)
  const auth = await authenticateApiKey(event, generationCost)
  if (!auth) {
    setResponseStatus(event, 401)
    return { error: { message: 'Invalid API key', type: 'authentication_error', code: 401 } }
  }

  if (!body.prompt) {
    setResponseStatus(event, 400)
    return { error: { message: 'prompt is required', type: 'invalid_request_error', code: 400 } }
  }

  const rejectedAudioUrl = unsupportedAudioUrl((payload.audio_urls as string[] | undefined) || [])
  if (rejectedAudioUrl) {
    setResponseStatus(event, 400)
    return {
      error: {
        message: `Unsupported audio format for Seedance 2: ${rejectedAudioUrl}. Allowed formats: mp3, wav.`,
        type: 'invalid_request_error',
        code: 400,
      },
    }
  }

  const model = payload.model_id
  const taskId = `vid-${randomUUID()}`
  const now = Date.now()

  const db = getDb()
  const config = loadConfig()
  const account = reserveAccountForCredits(generationCost)
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
      refundReservedCredits(account.id, generationCost)
      setResponseStatus(event, 502)
      return {
        error: {
          message: `ReelMind submission failed: ${submission.error}`,
          type: 'api_error',
          code: 502,
        },
      }
    }

    const referenceImageUrls = (
      (payload.reference_image_urls as string[] | undefined) ||
      (payload.image_urls as string[] | undefined)
    )

    db.insert(schema.tasks).values({
      taskId,
      object: 'video.generation',
      model,
      type: 'video',
      prompt: body.prompt,
      negativePrompt: payload.negative_prompt as string | undefined,
      imageUrl: referenceImageUrls?.[0],
      aspectRatio: (payload.aspect_ratio || payload.ratio) as string | undefined,
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

    await incrementUsage(auth.tokenId, generationCost)

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
    refundReservedCredits(account.id, generationCost)
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
