type GenerationBody = Record<string, any>

export type GenerationPayload = Record<string, unknown> & {
  model_id: string
  gen_type: string
}

function firstDefined<T>(...values: T[]): T | undefined {
  return values.find((value) => value !== undefined && value !== null)
}

function assignIfPresent(
  payload: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  if (value !== undefined && value !== null && value !== '') {
    payload[key] = value
  }
}

function toStringArray(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return []
  const values = Array.isArray(value) ? value : [value]
  return values
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function referenceImageUrls(body: GenerationBody): string[] {
  return [
    ...toStringArray(body.reference_image_urls),
    ...toStringArray(body.referenceImageUrls),
    ...toStringArray(body.reference_images),
    ...toStringArray(body.images),
    ...toStringArray(body.image),
    ...toStringArray(body.image_url),
    ...toStringArray(body.imageUrl),
  ]
}

export function buildVideoGenerationPayload(body: GenerationBody): GenerationPayload {
  const images = referenceImageUrls(body)
  const payload: GenerationPayload = {
    model_id: firstDefined(body.model_id, body.model, body.modelId) || 'reelmind-video',
    prompt: body.prompt,
    gen_type: firstDefined(
      body.gen_type,
      body.genType,
      images.length > 0 ? 'image-to-video' : 'text-to-video',
    )!,
  }

  assignIfPresent(
    payload,
    'negative_prompt',
    firstDefined(body.negative_prompt, body.negativePrompt),
  )
  assignIfPresent(payload, 'duration', body.duration)
  assignIfPresent(
    payload,
    'aspect_ratio',
    firstDefined(body.aspect_ratio, body.aspectRatio, body.size),
  )
  assignIfPresent(payload, 'resolution', firstDefined(body.resolution, body.size))
  assignIfPresent(payload, 'fps', body.fps)
  assignIfPresent(
    payload,
    'movement_amplitude',
    firstDefined(body.movement_amplitude, body.movementAmplitude),
  )
  assignIfPresent(payload, 'bgm', body.bgm)
  assignIfPresent(
    payload,
    'generate_audio',
    firstDefined(body.generate_audio, body.generateAudio),
  )
  assignIfPresent(
    payload,
    'generation_mode',
    firstDefined(body.generation_mode, body.generationMode),
  )
  if (images.length > 0) {
    payload.reference_image_urls = images
  }

  return payload
}

export function buildImageGenerationPayload(
  body: GenerationBody,
  genType: string,
): GenerationPayload {
  const images = referenceImageUrls(body)
  const payload: GenerationPayload = {
    model_id: firstDefined(body.model_id, body.model, body.modelId) || 'reelmind-image',
    gen_type: genType,
  }

  assignIfPresent(payload, 'prompt', body.prompt)
  assignIfPresent(
    payload,
    'negative_prompt',
    firstDefined(body.negative_prompt, body.negativePrompt),
  )
  assignIfPresent(payload, 'n', body.n)
  assignIfPresent(payload, 'resolution', firstDefined(body.resolution, body.size))
  assignIfPresent(
    payload,
    'aspect_ratio',
    firstDefined(body.aspect_ratio, body.aspectRatio),
  )
  assignIfPresent(payload, 'quality', body.quality)
  assignIfPresent(payload, 'style', body.style)
  assignIfPresent(payload, 'mask_url', firstDefined(body.mask_url, body.maskUrl, body.mask))
  if (images.length > 0) {
    payload.reference_image_urls = images
  }

  return payload
}
