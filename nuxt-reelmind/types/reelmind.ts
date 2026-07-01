export interface ModelSpec {
  id: string
  name: string
  source: 'new_arch' | 'byteplus'
  type?: 'text-to-video' | 'image-to-video' | 'text-to-image' | 'image-to-image'
  description?: string
  logo?: string
  config?: ModelConfig
  pricing?: ModelPricing
}

export interface ModelConfig {
  width: number
  height: number
  duration?: number
  fps?: number
  maxPrompts?: number
  supportedAspectRatios?: string[]
  supportedDurations?: number[]
}

export interface ModelPricing {
  basePrice: number
  currency: string
  perSecond?: number
  perGeneration?: number
}

export interface ModelsListResponse {
  data: ModelSpec[]
  total: number
  page: number
  limit: number
}

export interface ModelsListParams {
  page?: number
  limit?: number
  source?: string
  type?: string
}

export interface GenerationTaskPriceRequest {
  modelId: string
  prompt?: string
  negativePrompt?: string
  imageUrl?: string
  aspectRatio?: string
  duration?: number
  resolution?: string
  parameters?: Record<string, unknown>
}

export interface GenerationTaskPriceResponse {
  price: number
  currency: string
  credits: number
  estimatedTime?: number
}

export interface PricingQuoteRequest {
  modelId: string
  type: string
  quantity?: number
  parameters?: Record<string, unknown>
}

export interface PricingQuoteResponse {
  quotePrice: number
  currency: string
  breakdown?: PricingBreakdown[]
}

export interface PricingBreakdown {
  item: string
  cost: number
}

export interface AttributionRequest {
  sessionId?: string
  referrer?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
}

export interface LegoModelResponse {
  id: string
  name: string
  frames: LegoModelFrame[]
  config?: ModelConfig
}

export interface LegoModelFrame {
  id: string
  imageUrl: string
  prompt: string
  frameIndex: number
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface AuthSession {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  tokenType: string
  user: {
    id: string
    email: string
    name?: string
  }
}
