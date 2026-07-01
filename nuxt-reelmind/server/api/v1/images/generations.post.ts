import { randomUUID } from 'uncrypto'
import { authenticateApiKey, incrementUsage } from '../../../utils/api-auth'
import { getDb, schema } from '../../../db'
import { loadConfig } from '../../../utils/config'
import { eq } from 'drizzle-orm'

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
  const auth = await authenticateApiKey(event)
  if (!auth) {
    setResponseStatus(event, 401)
    return { error: { message: 'Invalid API key', type: 'authentication_error', code: 401 } }
  }

  const body = await readBody(event) as ImageGenerationRequest
  if (!body.prompt) {
    setResponseStatus(event, 400)
    return { error: { message: 'prompt is required', type: 'invalid_request_error', code: 400 } }
  }

  const model = body.model || 'reelmind-image'
  const taskId = `img-${randomUUID()}`
  const now = Date.now()

  // Parse size
  let resolution = body.size || '1024x1024'
  const sizeMatch = resolution.match(/(\d+)x(\d+)/)

  const db = getDb()

  // Submit to ReelMind
  const config = loadConfig()
  const account = db.select().from(schema.accounts).where(eq(schema.accounts.id, 1)).get()
  const authToken = account?.accessToken || ''

  try {
    const reelmindRes = await fetch(`${config.reelmind.api_base}/generation/task/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authToken ? `Bearer ${authToken}` : '',
        'Referer': config.reelmind.web_base,
      },
      body: JSON.stringify({
        modelId: model,
        prompt: body.prompt,
        negativePrompt: body.negative_prompt,
        imageUrl: body.image,
        aspectRatio: body.size,
        resolution: body.size,
        type: 'image',
      }),
    })

    let reelmindTaskId = ''

    if (reelmindRes.ok) {
      const resData: any = await reelmindRes.json()
      reelmindTaskId = resData.taskId || resData.id || ''
    }

    db.insert(schema.tasks).values({
      taskId,
      object: 'image.generation',
      model,
      type: 'image',
      prompt: body.prompt,
      negativePrompt: body.negative_prompt,
      imageUrl: body.image,
      aspectRatio: body.size,
      resolution: body.size,
      status: 'pending',
      reelmindTaskId,
      apiTokenId: auth.tokenId,
      createdAt: now,
      updatedAt: now,
    }).run()

    await incrementUsage(auth.tokenId, 1)

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
    setResponseStatus(event, 500)
    return { error: { message: `Submission failed: ${err.message}`, type: 'api_error', code: 500 } }
  }
})
