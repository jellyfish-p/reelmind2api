import type { PricingQuoteRequest, PricingQuoteResponse } from '../../../types/reelmind'
import { getBearerToken, nestPost } from '../../utils/reelmind-client'

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as PricingQuoteRequest

  const result = await nestPost<PricingQuoteResponse>(
    '/pricing/quote',
    body,
    getBearerToken(event),
  )
  return result
})
