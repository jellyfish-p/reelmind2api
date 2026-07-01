import type { LegoModelResponse } from '../../../types/reelmind'
import { getBearerToken, nestGet, toQueryParams } from '../../utils/reelmind-client'

export default defineEventHandler(async (event) => {
  const result = await nestGet<LegoModelResponse[]>(
    '/lego/models',
    toQueryParams(getQuery(event), ['page', 'limit']),
    getBearerToken(event),
  )
  return result
})
