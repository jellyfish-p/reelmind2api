import type { GenerationTaskPriceRequest, GenerationTaskPriceResponse } from '../../../types/reelmind'
import { getBearerToken, nestPost } from '../../utils/reelmind-client'

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as GenerationTaskPriceRequest

  const result = await nestPost<GenerationTaskPriceResponse>(
    '/generation/task/price',
    body,
    getBearerToken(event),
  )
  return result
})
