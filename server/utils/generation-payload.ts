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
    ...toStringArray(body.image_urls),
    ...toStringArray(body.imageUrls),
    ...toStringArray(body.input_image_urls),
    ...toStringArray(body.inputImageUrls),
    ...toStringArray(body.reference_images),
    ...toStringArray(body.images),
    ...toStringArray(body.image),
    ...toStringArray(body.image_url),
    ...toStringArray(body.imageUrl),
    ...toStringArray(body.refer_img_url),
    ...toStringArray(body.referImgUrl),
    ...toStringArray(body.input_image_url),
    ...toStringArray(body.inputImageUrl),
    ...toStringArray(body.start_image_url),
    ...toStringArray(body.startImageUrl),
    ...toStringArray(body.first_image_url),
    ...toStringArray(body.firstImageUrl),
    ...toStringArray(body.first_frame_url),
    ...toStringArray(body.firstFrameUrl),
    ...toStringArray(body.end_image_url),
    ...toStringArray(body.endImageUrl),
    ...toStringArray(body.last_image_url),
    ...toStringArray(body.lastImageUrl),
    ...toStringArray(body.last_frame_url),
    ...toStringArray(body.lastFrameUrl),
    ...toStringArray(body.tail_image_url),
    ...toStringArray(body.tailImageUrl),
  ]
}

function reelmindImageUrls(body: GenerationBody): string[] {
  return [
    ...toStringArray(body.image_urls),
    ...toStringArray(body.imageUrls),
    ...toStringArray(body.input_image_urls),
    ...toStringArray(body.inputImageUrls),
  ]
}

function referenceVideoUrls(body: GenerationBody): string[] {
  return [
    ...toStringArray(body.video_urls),
    ...toStringArray(body.videoUrls),
    ...toStringArray(body.videos),
    ...toStringArray(body.video),
    ...toStringArray(body.video_url),
    ...toStringArray(body.videoUrl),
    ...toStringArray(body.input_video_url),
    ...toStringArray(body.inputVideoUrl),
  ]
}

function referenceAudioUrls(body: GenerationBody): string[] {
  return [
    ...toStringArray(body.audio_urls),
    ...toStringArray(body.audioUrls),
    ...toStringArray(body.audios),
    ...toStringArray(body.audio),
    ...toStringArray(body.audio_url),
    ...toStringArray(body.audioUrl),
    ...toStringArray(body.input_audio_url),
    ...toStringArray(body.inputAudioUrl),
  ]
}

function explicitReferImageUrls(body: GenerationBody): string[] {
  return [
    ...toStringArray(body.refer_img_url),
    ...toStringArray(body.referImgUrl),
  ]
}

function reelMindReferImageUrl(body: GenerationBody, images: string[]): string | undefined {
  return firstDefined(
    ...explicitReferImageUrls(body),
    ...toStringArray(body.image_url),
    ...toStringArray(body.imageUrl),
    images[0],
  )
}

function defaultVideoGenType(
  images: string[],
  videos: string[],
  audios: string[],
  hasReelMindImageFields: boolean,
): string {
  if (hasReelMindImageFields) return 'image-to-video'
  if (audios.length > 0 || (images.length > 0 && videos.length > 0)) {
    return 'reference-to-video'
  }
  if (hasReelMindImageFields || images.length > 0) return 'image-to-video'
  if (videos.length > 0) return 'video-to-video'
  return 'text-to-video'
}

export function unsupportedAudioUrl(audioUrls: string[]): string | undefined {
  for (const audioUrl of audioUrls) {
    const lowerUrl = audioUrl.toLowerCase()
    if (lowerUrl.startsWith('data:audio/')) {
      if (!lowerUrl.startsWith('data:audio/mpeg') && !lowerUrl.startsWith('data:audio/mp3') && !lowerUrl.startsWith('data:audio/wav')) {
        return audioUrl
      }
      continue
    }

    const pathname = lowerUrl.split('?')[0].split('#')[0]
    const extension = pathname.match(/\.([a-z0-9]+)$/)?.[1]
    if (extension && extension !== 'mp3' && extension !== 'wav') {
      return audioUrl
    }
  }
  return undefined
}

export function buildVideoGenerationPayload(body: GenerationBody): GenerationPayload {
  const images = referenceImageUrls(body)
  const directImageUrls = reelmindImageUrls(body)
  const videos = referenceVideoUrls(body)
  const audios = referenceAudioUrls(body)
  const referImageUrl = reelMindReferImageUrl(body, images)
  const hasReelMindImageFields =
    directImageUrls.length > 0 || explicitReferImageUrls(body).length > 0

  const payload: GenerationPayload = {
    model_id: firstDefined(body.model_id, body.model, body.modelId) || 'reelmind-video',
    prompt: body.prompt,
    gen_type: firstDefined(
      body.gen_type,
      body.genType,
      defaultVideoGenType(images, videos, audios, hasReelMindImageFields),
    )!,
  }

  assignIfPresent(
    payload,
    'negative_prompt',
    firstDefined(body.negative_prompt, body.negativePrompt),
  )
  assignIfPresent(payload, 'duration', body.duration)
  assignIfPresent(payload, 'ratio', body.ratio)
  if (!payload.ratio) {
    assignIfPresent(
      payload,
      'aspect_ratio',
      firstDefined(body.aspect_ratio, body.aspectRatio, body.size),
    )
  }
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
  assignIfPresent(payload, 'watermark', body.watermark)
  if (images.length > 0) {
    if (hasReelMindImageFields) {
      payload.image_urls = directImageUrls.length > 0 ? directImageUrls : images
      assignIfPresent(payload, 'refer_img_url', referImageUrl)
    } else {
      payload.reference_image_urls = images
    }
  }
  if (videos.length > 0) {
    payload.video_urls = videos
  }
  if (audios.length > 0) {
    payload.audio_urls = audios
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
