import { randomUUID } from 'uncrypto'
import { authenticateApiKey, incrementUsage } from '../../../utils/api-auth'
import { getDb, schema } from '../../../db'
import { loadConfig } from '../../../utils/config'
import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const auth = await authenticateApiKey(event)
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
  const account = db.select().from(schema.accounts).where(eq(schema.accounts.id, 1)).get()
  const authToken = account?.accessToken || ''

  try {
    const body: Record<string, unknown> = {
      modelId: model,
      prompt,
      imageUrl: imageDataUrl,
      type: 'image-edit',
      resolution: size,
      n,
    }
    if (maskDataUrl) body.maskUrl = maskDataUrl

    const reelmindRes = await fetch(`${config.reelmind.api_base}/generation/task/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authToken ? `Bearer ${authToken}` : '',
        'Referer': config.reelmind.web_base,
      },
      body: JSON.stringify(body),
    })

    let reelmindTaskId = ''
    if (reelmindRes.ok) {
      const resData: any = await reelmindRes.json()
      reelmindTaskId = resData.taskId || resData.id || ''
    }

    db.insert(schema.tasks).values({
      taskId,
      object: 'image.edit',
      model,
      type: 'image-edit',
      prompt,
      imageUrl: imageDataUrl.substring(0, 1000),
      resolution: size,
      status: 'pending',
      reelmindTaskId,
      apiTokenId: auth.tokenId,
      createdAt: now,
      updatedAt: now,
    }).run()

    await incrementUsage(auth.tokenId, 2)

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
    setResponseStatus(event, 500)
    return { error: { message: `Edit submission failed: ${err.message}`, type: 'api_error', code: 500 } }
  }
})
