import type { ModelsListResponse } from '../../../types/reelmind'
import { getBearerToken, nestGet, toQueryParams } from '../../utils/reelmind-client'

export default defineEventHandler(async (event) => {
  const result = await nestGet<ModelsListResponse>(
    '/models/search',
    toQueryParams(getQuery(event), ['page', 'limit']),
    getBearerToken(event),
  )
  return result
})
