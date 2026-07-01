import { describe, expect, it } from 'vitest'
import {
  buildImageGenerationPayload,
  buildVideoGenerationPayload,
} from '../server/utils/generation-payload'
import {
  extractResultUrl,
  extractCreditsUsed,
  extractTaskStatus,
  extractUpstreamTaskId,
} from '../server/utils/upstream-task'

describe('generation payload helpers', () => {
  it('builds snake_case video generation payloads without legacy fields', () => {
    const payload = buildVideoGenerationPayload({
      model: 'video-model',
      prompt: 'a robot paints a mural',
      negative_prompt: 'blur, low quality',
      image: 'https://cdn.example.test/ref.png',
      duration: 5,
      aspect_ratio: '16:9',
      resolution: '1080p',
      fps: 24,
      movement_amplitude: 'medium',
      bgm: true,
      generate_audio: false,
      generation_mode: 'fast',
    })

    expect(payload).toMatchObject({
      model_id: 'video-model',
      prompt: 'a robot paints a mural',
      negative_prompt: 'blur, low quality',
      gen_type: 'image-to-video',
      duration: 5,
      aspect_ratio: '16:9',
      resolution: '1080p',
      reference_image_urls: ['https://cdn.example.test/ref.png'],
      fps: 24,
      movement_amplitude: 'medium',
      bgm: true,
      generate_audio: false,
      generation_mode: 'fast',
    })
    expect(payload).not.toHaveProperty('modelId')
    expect(payload).not.toHaveProperty('negativePrompt')
    expect(payload).not.toHaveProperty('imageUrl')
    expect(payload).not.toHaveProperty('type')
  })

  it('normalizes legacy camelCase generation inputs into snake_case payloads', () => {
    const payload = buildVideoGenerationPayload({
      modelId: 'legacy-video-model',
      prompt: 'a glass city at night',
      negativePrompt: 'noisy',
      imageUrl: 'https://cdn.example.test/legacy.png',
      aspectRatio: '9:16',
      genType: 'image-to-video',
    })

    expect(payload).toMatchObject({
      model_id: 'legacy-video-model',
      negative_prompt: 'noisy',
      aspect_ratio: '9:16',
      gen_type: 'image-to-video',
      reference_image_urls: ['https://cdn.example.test/legacy.png'],
    })
    expect(payload).not.toHaveProperty('modelId')
    expect(payload).not.toHaveProperty('negativePrompt')
    expect(payload).not.toHaveProperty('imageUrl')
    expect(payload).not.toHaveProperty('aspectRatio')
  })

  it('builds snake_case image generation payloads for text, edit, and variation requests', () => {
    const textToImage = buildImageGenerationPayload(
      {
        model: 'image-model',
        prompt: 'a ceramic fox lamp',
        negative_prompt: 'text watermark',
        n: 2,
        size: '1024x1024',
      },
      'text-to-image',
    )
    expect(textToImage).toMatchObject({
      model_id: 'image-model',
      prompt: 'a ceramic fox lamp',
      negative_prompt: 'text watermark',
      gen_type: 'text-to-image',
      n: 2,
      resolution: '1024x1024',
    })

    const edit = buildImageGenerationPayload(
      {
        prompt: 'replace the sky with sunset',
        image: 'data:image/png;base64,image-bytes',
        mask: 'data:image/png;base64,mask-bytes',
        resolution: '1536x1024',
      },
      'image-edit',
    )
    expect(edit).toMatchObject({
      model_id: 'reelmind-image',
      prompt: 'replace the sky with sunset',
      gen_type: 'image-edit',
      reference_image_urls: ['data:image/png;base64,image-bytes'],
      mask_url: 'data:image/png;base64,mask-bytes',
      resolution: '1536x1024',
    })

    const variation = buildImageGenerationPayload(
      {
        image: ['https://cdn.example.test/a.png', 'https://cdn.example.test/b.png'],
        n: 3,
      },
      'image-variation',
    )
    expect(variation).toMatchObject({
      model_id: 'reelmind-image',
      gen_type: 'image-variation',
      reference_image_urls: [
        'https://cdn.example.test/a.png',
        'https://cdn.example.test/b.png',
      ],
      n: 3,
    })

    for (const payload of [textToImage, edit, variation]) {
      expect(payload).not.toHaveProperty('modelId')
      expect(payload).not.toHaveProperty('negativePrompt')
      expect(payload).not.toHaveProperty('imageUrl')
      expect(payload).not.toHaveProperty('type')
    }
  })

  it('keeps image route generation type authoritative over request body overrides', () => {
    const payload = buildImageGenerationPayload(
      {
        prompt: 'a small product photo',
        gen_type: 'image-variation',
        genType: 'video',
      },
      'text-to-image',
    )

    expect(payload.gen_type).toBe('text-to-image')
  })

  it('extracts upstream task ids from common response shapes', () => {
    expect(extractUpstreamTaskId({ task_id: 'snake' })).toBe('snake')
    expect(extractUpstreamTaskId({ taskId: 'camel' })).toBe('camel')
    expect(extractUpstreamTaskId({ id: 'id-value' })).toBe('id-value')
    expect(extractUpstreamTaskId({ data: { task_id: 'data-snake' } })).toBe(
      'data-snake',
    )
    expect(extractUpstreamTaskId({ data: { taskId: 'data-camel' } })).toBe(
      'data-camel',
    )
    expect(extractUpstreamTaskId({ task: { id: 'nested-task' } })).toBe(
      'nested-task',
    )
  })

  it('extracts result URLs from common completion response shapes', () => {
    expect(extractResultUrl({ result_url: 'https://result.test/snake.mp4' })).toBe(
      'https://result.test/snake.mp4',
    )
    expect(extractResultUrl({ resultUrl: 'https://result.test/camel.mp4' })).toBe(
      'https://result.test/camel.mp4',
    )
    expect(
      extractResultUrl({ output: { video_url: 'https://result.test/video.mp4' } }),
    ).toBe('https://result.test/video.mp4')
    expect(
      extractResultUrl({ output: { image_url: 'https://result.test/image.png' } }),
    ).toBe('https://result.test/image.png')
    expect(extractResultUrl({ output_result: 'https://result.test/raw.mp4' })).toBe(
      'https://result.test/raw.mp4',
    )
    expect(
      extractResultUrl({
        output_result: [
          'https://result.test/first.png',
          'https://result.test/second.png',
        ],
      }),
    ).toBe('https://result.test/first.png')
  })

  it('extracts nested task status and credits from status responses', () => {
    expect(extractTaskStatus({ data: { status: 'completed' } })).toBe(
      'completed',
    )
    expect(extractCreditsUsed({ data: { credits_used: 7 } })).toBe(7)
    expect(extractCreditsUsed({ data: { usage: { credits: 5 } } })).toBe(5)
  })
})
