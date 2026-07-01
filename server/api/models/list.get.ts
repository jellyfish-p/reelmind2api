import type { ModelsListResponse, ModelsListParams } from '../../../types/reelmind'
import { getBearerToken, nestGet, toQueryParams } from '../../utils/reelmind-client'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const params = toQueryParams(query, ['page', 'limit']) as ModelsListParams

  const result = await nestGet<ModelsListResponse>('/models', {
    page: params.page,
    limit: params.limit,
    source: params.source,
    type: params.type,
  }, getBearerToken(event))

  return result
})
