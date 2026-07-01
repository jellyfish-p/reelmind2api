import type { ModelsListResponse } from '../../../types/reelmind'
import { getBearerToken, nestGet, toQueryParams } from '../../utils/reelmind-client'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const params = toQueryParams(query, ['page', 'limit'])

  const result = await nestGet<ModelsListResponse>('/models', {
    page: params.page,
    limit: params.limit,
    source: 'new_arch,byteplus',
    type: 'image-to-video',
  }, getBearerToken(event))

  return result
})
