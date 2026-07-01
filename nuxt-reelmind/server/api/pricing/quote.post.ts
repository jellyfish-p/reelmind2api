import type { PricingQuoteRequest, PricingQuoteResponse } from '../../../types/reelmind'

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as PricingQuoteRequest
  const authHeader = getHeader(event, 'authorization')
  const token = authHeader?.replace('Bearer ', '')

  const result = await nestPost<PricingQuoteResponse>(
    '/pricing/quote',
    body,
    token,
  )
  return result
})
