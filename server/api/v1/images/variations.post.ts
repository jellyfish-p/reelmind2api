import { randomUUID } from 'uncrypto'
import { authenticateApiKey, incrementUsage } from '../../../utils/api-auth'
import { getDb, schema } from '../../../db'
import { loadConfig } from '../../../utils/config'
import { buildImageGenerationPayload } from '../../../utils/generation-payload'
import { readUpstreamTaskId } from '../../../utils/upstream-task'
import { eq } from 'drizzle-orm'

const IMAGE_VARIATION_COST = 1

export default defineEventHandler(async (event) => {
  const auth = await authenticateApiKey(event, IMAGE_VARIATION_COST)
  if (!auth) {
    setResponseStatus(event, 401)
    return { error: { message: 'Invalid API key', type: 'authentication_error', code: 401 } }
  }

  const formData = await readFormData(event)
  const imageFile = formData.get('image') as File | null
  const model = formData.get('model')?.toString() || 'reelmind-image'
  const size = formData.get('size')?.toString() || '1024x1024'
  const n = parseInt(formData.get('n')?.toString() || '1')

  if (!imageFile) {
    setResponseStatus(event, 400)
    return { error: { message: 'image file is required', type: 'invalid_request_error', code: 400 } }
  }

  const taskId = `var-${randomUUID()}`
  const now = Date.now()

  const imageBuffer = Buffer.from(await imageFile.arrayBuffer())
  const imageBase64 = imageBuffer.toString('base64')
  const imageDataUrl = `data:${imageFile.type || 'image/png'};base64,${imageBase64}`

  const db = getDb()
  const config = loadConfig()
  const account = db.select().from(schema.accounts).where(eq(schema.accounts.id, 1)).get()
  const authToken = account?.accessToken || ''

  try {
    const payload = buildImageGenerationPayload({
      model,
      image: imageDataUrl,
      size,
      n,
    }, 'image-variation')

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

    db.insert(schema.tasks).values({
      taskId,
      object: 'image.variation',
      model,
      type: 'image-variation',
      prompt: '',
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

    await incrementUsage(auth.tokenId, IMAGE_VARIATION_COST)

    return {
      id: taskId,
      object: 'image.variation',
      created: Math.floor(now / 1000),
      model,
      status: 'pending',
      data: [],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }
  } catch (err: any) {
    setResponseStatus(event, 500)
    return { error: { message: `Variation submission failed: ${err.message}`, type: 'api_error', code: 500 } }
  }
})
