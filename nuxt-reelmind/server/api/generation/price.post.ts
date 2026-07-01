import type { GenerationTaskPriceRequest, GenerationTaskPriceResponse } from '../../../types/reelmind'

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as GenerationTaskPriceRequest
  const authHeader = getHeader(event, 'authorization')
  const token = authHeader?.replace('Bearer ', '')

  const result = await nestPost<GenerationTaskPriceResponse>(
    '/generation/task/price',
    body,
    token,
  )
  return result
})
