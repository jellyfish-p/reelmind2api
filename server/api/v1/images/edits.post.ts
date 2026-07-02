import { randomUUID } from 'uncrypto'
import { authenticateApiKey, incrementUsage } from '../../../utils/api-auth'
import { getDb, schema } from '../../../db'
import { loadConfig } from '../../../utils/config'
import { refundReservedCredits, reserveAccountForCredits } from '../../../utils/account-pool'
import { IMAGE_GENERATION_COST } from '../../../utils/generation-costs'
import { buildImageGenerationPayload } from '../../../utils/generation-payload'
import { readUpstreamTaskId } from '../../../utils/upstream-task'

const IMAGE_EDIT_COST = IMAGE_GENERATION_COST

export default defineEventHandler(async (event) => {
  const auth = await authenticateApiKey(event, IMAGE_EDIT_COST)
  if (!auth) {
    setResponseStatus(event, 401)
    return { error: { message: 'Invalid API key', type: 'authentication_error', code: 401 } }
  }

  const formData = await readFormData(event)
  const imageFile = formData.get('image') as File | null
  const maskFile = formData.get('mask') as File | null
  const prompt = formData.get('prompt')?.toString() || ''
  const model = formData.get('model')?.toString() || 'reelmind-image'
  const size = formData.get('size')?.toString() || '1024x1024'
  const n = parseInt(formData.get('n')?.toString() || '1')
  const negativePrompt = formData.get('negative_prompt')?.toString()

  if (!imageFile) {
    setResponseStatus(event, 400)
    return { error: { message: 'image file is required', type: 'invalid_request_error', code: 400 } }
  }
  if (!prompt) {
    setResponseStatus(event, 400)
    return { error: { message: 'prompt is required', type: 'invalid_request_error', code: 400 } }
  }

  const taskId = `edit-${randomUUID()}`
  const now = Date.now()

  const imageBuffer = Buffer.from(await imageFile.arrayBuffer())
  const imageBase64 = imageBuffer.toString('base64')
  const imageDataUrl = `data:${imageFile.type || 'image/png'};base64,${imageBase64}`

  let maskDataUrl: string | undefined
  if (maskFile) {
    const maskBuffer = Buffer.from(await maskFile.arrayBuffer())
    const maskBase64 = maskBuffer.toString('base64')
    maskDataUrl = `data:${maskFile.type || 'image/png'};base64,${maskBase64}`
  }

  const db = getDb()
  const config = loadConfig()
  const account = reserveAccountForCredits(IMAGE_EDIT_COST)
  if (!account) {
    setResponseStatus(event, 503)
    return noAvailableAccountError()
  }
  const authToken = account.accessToken || ''

  try {
    const payload = buildImageGenerationPayload({
      model,
      prompt,
      image: imageDataUrl,
      mask: maskDataUrl,
      size,
      n,
      negative_prompt: negativePrompt,
    }, 'image-edit')

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
      refundReservedCredits(account.id, IMAGE_EDIT_COST)
      setResponseStatus(event, 502)
      return {
        error: {
          message: `ReelMind submission failed: ${submission.error}`,
          type: 'api_error',
          code: 502,
        },
      }
    }

    db.insert(schema.tasks).values({
      taskId,
      object: 'image.edit',
      model,
      type: 'image-edit',
      prompt,
      negativePrompt: payload.negative_prompt as string | undefined,
      imageUrl: imageDataUrl.substring(0, 1000),
      resolution: payload.resolution as string | undefined,
      parameters: JSON.stringify(payload),
      status: 'pending',
      reelmindTaskId: submission.taskId,
      apiTokenId: auth.tokenId,
      accountId: account?.id,
      createdAt: now,
      updatedAt: now,
    }).run()

    await incrementUsage(auth.tokenId, IMAGE_EDIT_COST)

    return {
      id: taskId,
      object: 'image.edit',
      created: Math.floor(now / 1000),
      model,
      status: 'pending',
      data: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }
  } catch (err: any) {
    refundReservedCredits(account.id, IMAGE_EDIT_COST)
    setResponseStatus(event, 500)
    return { error: { message: `Edit submission failed: ${err.message}`, type: 'api_error', code: 500 } }
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
